const Web3 = require("web3");
const { mongoose } = require("mongoose");
const { Schema, model } = mongoose;
const { Alchemy, Network } = require("alchemy-sdk");

const config = {
  apiKey: "iUoU4-RGEuoxIGLrQjRvEGP0JRxeEXll",
  network: Network.ETH_MAINNET,
};
const alchemy = new Alchemy(config);
const web3 = new Web3(
  "wss://mainnet.infura.io/ws/v3/c977307fce2e4cdb9d6904ec3c4f8469"
);

const nftsSchema = new Schema({
  nftContract: String,
  count: Number,
  collectionsCounters: [
    {
      contract: String,
      minters: [],
    },
  ],
});
let NftsModel;
let supportedNftCollections = {
  "0x0000000010C38b3D8B4D642D9D065FB69BC77bC7": [],
  "0x2809a8737477a534df65c4b4cae43d0365e52035": [],
};

async function updateCollectionOwners() {
  supportedNftCollectionsKeys = Object.keys(supportedNftCollections);
  for (let i = 0; i < supportedNftCollectionsKeys.length; i++) {
    owners = await alchemy.nft.getOwnersForContract(
      supportedNftCollectionsKeys[i]
    );
    supportedNftCollections[supportedNftCollectionsKeys[i]] = owners.owners;
  }
}

async function initializeBot() {
  await mongoose.connect(
    "mongodb+srv://giggs:13241324@cluster0.uthxjrj.mongodb.net/?retryWrites=true&w=majority"
  );
  //alreadyMintedContractsModel = await model('MintedContracts', alreadyMintedContractsSchema);
  NftsModel = await model("NFTs", nftsSchema);
  // await alreadyMintedContractsModel.create({
  //     identity: 1,
  //     mintedContracts: []
  // });
  // nftsAlreadyMintedContracts = await alreadyMintedContractsModel.findOne({ 'identity': 1 }).then(res => nftsAlreadyMintedContracts = res['mintedContracts']).catch(err => console.log(err));
  // console.log(nftsAlreadyMintedContracts);
  NftsModel.watch().on("change", (data) => {
    // if(data.operationType === 'update') {
    //     console.log(data.updateDescription.updatedFields);
    // }
  });
  updateCollectionOwners();
  setInterval(updateCollectionOwners, 86400000);
}
initializeBot();

const options721 = {
  topics: [web3.utils.sha3("Transfer(address,address,uint256)")],
};
const options1155 = {
  topics: [
    web3.utils.sha3("TransferSingle(address,address,address,uint256,uint256)"),
  ],
};
const subscription721 = web3.eth.subscribe("logs", options721);
const subscription1155 = web3.eth.subscribe("logs", options1155);

subscription721.on("data", async (event) => {
  if (event.topics.length == 4) {
    let transaction = web3.eth.abi.decodeLog(
      [
        {
          type: "address",
          name: "from",
          indexed: true,
        },
        {
          type: "address",
          name: "to",
          indexed: true,
        },
        {
          type: "uint256",
          name: "tokenId",
          indexed: true,
        },
      ],
      event.data,
      [event.topics[1], event.topics[2], event.topics[3]]
    );

    if (transaction.from === "0x0000000000000000000000000000000000000000") {
      console.log(
        `\n` +
          `New ERC-712 transaction found in block ${event.blockNumber} with hash ${event.transactionHash}\n` +
          `From: ${
            transaction.from === "0x0000000000000000000000000000000000000000"
              ? "New mint!"
              : transaction.from
          }\n` +
          `To: ${transaction.to}\n` +
          `Token contract: ${event.address}\n` +
          `Token ID: ${transaction.tokenId}`
      );

      await handleMintTransaction(event, transaction);
    }
  }
});

subscription1155.on("data", async (event) => {
  let transaction = web3.eth.abi.decodeLog(
    [
      {
        type: "address",
        name: "operator",
        indexed: true,
      },
      {
        type: "address",
        name: "from",
        indexed: true,
      },
      {
        type: "address",
        name: "to",
        indexed: true,
      },
      {
        type: "uint256",
        name: "id",
      },
      {
        type: "uint256",
        name: "value",
      },
    ],
    event.data,
    [event.topics[1], event.topics[2], event.topics[3]]
  );

  if (transaction.from === "0x0000000000000000000000000000000000000000") {
    console.log(
      `\n` +
        `New ERC-1155 transaction found in block ${event.blockNumber} with hash ${event.transactionHash}\n` +
        `Operator: ${transaction.operator}\n` +
        `From: ${
          transaction.from === "0x0000000000000000000000000000000000000000"
            ? "New mint!"
            : transaction.from
        }\n` +
        `To: ${transaction.to}\n` +
        `id: ${transaction.id}\n` +
        `value: ${transaction.value}`
    );

    //await handleMintTransaction(event, transaction);
  }
});

subscription721.on("error", (err) => {
  throw err;
});
subscription1155.on("error", (err) => {
  throw err;
});
subscription721.on("connected", (nr) =>
  console.log("Subscription on ERC-721 started with ID %s", nr)
);
subscription1155.on("connected", (nr) =>
  console.log("Subscription on ERC-1155 started with ID %s", nr)
);

async function handleMintTransaction(event, transaction) {
  let update = {
    $setOnInsert: {
      nftContract: event.address,
      count: 1,
      collectionsCounters: checkCollectionCountersForNewContractMint(
        transaction.to
      ),
    },
  };

  const isInserted = await NftsModel.findOneAndUpdate(
    { nftContract: event.address },
    update,
    { upsert: true }
  ).catch((error) => console.error(error));
  if (isInserted) {
    await checkCollectionCountersForAlreadyAddedContractMint(
      event.address,
      transaction.to
    );
  }
}

async function checkCollectionCountersForAlreadyAddedContractMint(
  contractAddress,
  minterAddress
) {
  supportedNftCollectionsKeys = Object.keys(supportedNftCollections);
  for (let i = 0; i < supportedNftCollectionsKeys.length; i++) {
    if (
      supportedNftCollections[supportedNftCollectionsKeys[i]].includes(
        minterAddress
      )
    ) {
      console.log("hopppa: ", contractAddress, ": ", minterAddress);
      await NftsModel.updateMany(
        {
          nftContract: contractAddress,
          "collectionsCounters.contract": supportedNftCollectionsKeys[i],
        },
        {
          $addToSet: {
            "collectionsCounters.$.minters": minterAddress,
          },
        }
      ).catch((err) => console.log(err));
    }
  }
}

function checkCollectionCountersForNewContractMint(minterAddress) {
  collectionsCounters = [];
  supportedNftCollectionsKeys = Object.keys(supportedNftCollections);
  for (let i = 0; i < supportedNftCollectionsKeys.length; i++) {
    if (
      supportedNftCollections[supportedNftCollectionsKeys[i]].includes(
        minterAddress
      )
    ) {
      collectionsCounters.push({
        contract: supportedNftCollectionsKeys[i],
        minters: [minterAddress],
      });
      console.log("hoppa");
    } else {
      collectionsCounters.push({
        contract: supportedNftCollectionsKeys[i],
        minters: [],
      });
    }
  }
  return collectionsCounters;
}
