const express = require("express");
const axios = require("axios");
const Web3 = require("web3");
const Bottleneck = require("bottleneck");
const LogsDecoder = require("logs-decoder"); // NodeJS
const logsDecoder = LogsDecoder.create();
const { Telegraf } = require("telegraf");
const botToken = "5838845209:AAF-FAJxSiULozFcgcP5APNNaZCiwPNIENs";
const groupIds = [-996857008, -787443779];

const app = express();
const port = process.env.PORT || 3002;

app.get("/", (req, res) => {
  res.send("Listening for logs...");
});
const ERC721_LOG_HEX =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ERC1155_LOG_HEX =
  "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
// Configuration

const config = {
  providerUrls: [
    "wss://eth-mainnet.g.alchemy.com/v2/8ajQ1ziufCt9OHtyMv2ZeQUudTQIN-Pq",
    "wss://mainnet.infura.io/ws/v3/df99f40851a24223a822f842051861c3",
    "wss://api.zmok.io/mainnet/16oocpvtnmkvnw6z",
  ],
  etherscanApiKey: "VGW1CAIWZKTCZAFV2CI94E7S4TDYYA1IGF",
  filter: {
    topics: [[ERC721_LOG_HEX, ERC1155_LOG_HEX], null, null],
  },
  reconnectDelay: 3000,
};
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);

  const etherscanApiUrl = `https://api.etherscan.io/api?apikey=${config.etherscanApiKey}`;

  const web3Providers = config.providerUrls.map((url) => new Web3(url));
  const rateLimiter = new Bottleneck({ minTime: 200 });
  const processedTransactions = new Map();
  const performAction = async (log, web3Provider) => {
    try {
      if (log.topics[0] === ERC721_LOG_HEX) {
        log = decodeERC721LogsData(log);
        if (log.topics[1] === "0x0000000000000000000000000000000000000000") {
          const messageText = log.transactionHash;
          sendMessageToGroups(groupIds, messageText, botToken)
            .then(() => console.log("Done"))
            .catch(console.error);
        }
      } else if (log.topics[0] === ERC1155_LOG_HEX) {
        let decodedLog = decodeERC1155LogsData(log);
      }

      const primaryWeb3Provider = new Web3(config.providerUrls[0]);
      let transaction = await primaryWeb3Provider.eth.getTransaction(
        log.transactionHash
      );
      transaction.log = log;
    } catch (error) {
      console.error("Error fetching transaction details:", error);
    }
  };
  const processLog = (log, web3Provider) => {
    if (log.topics.length === 4) {
      const transactionHash = log.transactionHash;
      if (!processedTransactions.has(transactionHash)) {
        if (web3Provider) {
          performAction(log, web3Provider);
          processedTransactions.set(transactionHash, true);
        } else {
          console.log(web3Provider);
        }
      }
    }
  };

  const subscribeToLogs = (web3Provider) => {
    const subscribeWithReconnect = () => {
      web3Provider.eth
        .subscribe("logs", config.filter, async (error, log) => {
          if (error) {
            console.error("Error subscribing to logs:", error);
            setTimeout(() => subscribeWithReconnect(), config.reconnectDelay);
            return;
          }
          processLog(log, web3Provider);
        })
        .on("error", (error) => {
          console.error("WebSocket error:", error);
          setTimeout(() => subscribeWithReconnect(), config.reconnectDelay);
        });
    };

    subscribeWithReconnect();
  };

  const fetchLogsFromEtherscan = async (fromBlock, filter) => {
    const encodedFromBlock = `0x${fromBlock.toString(16)}`;
    const encodedToBlock = `0x${fromBlock.toString(16)}`;

    const fetchLogsForFilter = async (filter) => {
      const response = await rateLimiter.schedule(() =>
        axios.get(
          `${etherscanApiUrl}&module=logs&action=getLogs&fromBlock=${
            fromBlock - 2
          }&toBlock=9999999999999&topic0=${filter}`
        )
      );

      if (response.data && response.data.result) {
        return response.data.result;
      }

      throw new Error("Failed to fetch logs from Etherscan");
    };

    try {
      const logs1 = await fetchLogsForFilter(filter.topics[0][0]);
      const logs2 = await fetchLogsForFilter(filter.topics[0][1]);
      return logs1.concat(logs2);
    } catch (error) {
      throw new Error("Failed to fetch logs from Etherscan");
    }
  };

  const subscribeToBlocks = (web3Provider) => {
    const subscribeWithReconnect = () => {
      web3Provider.eth
        .subscribe("newBlockHeaders", async (error, blockHeader) => {
          if (error) {
            console.error("Error subscribing to new blocks:", error);
            setTimeout(() => subscribeWithReconnect(), config.reconnectDelay);
            return;
          }

          const blockNumber = blockHeader.number;

          // Fetch logs from Etherscan for the new block
          const logs = await fetchLogsFromEtherscan(blockNumber, config.filter);
          const filteredLogs = logs.filter((log) => log.topics.length === 4);
          // Process logs from Etherscan
          filteredLogs.forEach(processLog);
        })
        .on("error", (error) => {
          console.error("WebSocket error:", error);
          setTimeout(() => subscribeWithReconnect(), config.reconnectDelay);
        });
    };

    subscribeWithReconnect();
  };

  web3Providers.forEach(subscribeToLogs);
  web3Providers.forEach(subscribeToBlocks);
});

function decodeERC1155LogsData(logs) {
  const abi = [
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          internalType: "address",
          name: "account",
          type: "address",
        },
        {
          indexed: true,
          internalType: "address",
          name: "operator",
          type: "address",
        },
        {
          indexed: false,
          internalType: "bool",
          name: "approved",
          type: "bool",
        },
      ],
      name: "ApprovalForAll",
      type: "event",
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          internalType: "address",
          name: "operator",
          type: "address",
        },
        {
          indexed: true,
          internalType: "address",
          name: "from",
          type: "address",
        },
        { indexed: true, internalType: "address", name: "to", type: "address" },
        {
          indexed: false,
          internalType: "uint256[]",
          name: "ids",
          type: "uint256[]",
        },
        {
          indexed: false,
          internalType: "uint256[]",
          name: "values",
          type: "uint256[]",
        },
      ],
      name: "TransferBatch",
      type: "event",
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          internalType: "address",
          name: "operator",
          type: "address",
        },
        {
          indexed: true,
          internalType: "address",
          name: "from",
          type: "address",
        },
        { indexed: true, internalType: "address", name: "to", type: "address" },
        {
          indexed: false,
          internalType: "uint256",
          name: "id",
          type: "uint256",
        },
        {
          indexed: false,
          internalType: "uint256",
          name: "value",
          type: "uint256",
        },
      ],
      name: "TransferSingle",
      type: "event",
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: false,
          internalType: "string",
          name: "value",
          type: "string",
        },
        { indexed: true, internalType: "uint256", name: "id", type: "uint256" },
      ],
      name: "URI",
      type: "event",
    },
    {
      inputs: [
        { internalType: "address", name: "account", type: "address" },
        { internalType: "uint256", name: "id", type: "uint256" },
      ],
      name: "balanceOf",
      outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [
        { internalType: "address[]", name: "accounts", type: "address[]" },
        { internalType: "uint256[]", name: "ids", type: "uint256[]" },
      ],
      name: "balanceOfBatch",
      outputs: [{ internalType: "uint256[]", name: "", type: "uint256[]" }],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [
        { internalType: "address", name: "account", type: "address" },
        { internalType: "address", name: "operator", type: "address" },
      ],
      name: "isApprovedForAll",
      outputs: [{ internalType: "bool", name: "", type: "bool" }],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [
        { internalType: "address", name: "from", type: "address" },
        { internalType: "address", name: "to", type: "address" },
        { internalType: "uint256[]", name: "ids", type: "uint256[]" },
        { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
        { internalType: "bytes", name: "data", type: "bytes" },
      ],
      name: "safeBatchTransferFrom",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
    {
      inputs: [
        { internalType: "address", name: "from", type: "address" },
        { internalType: "address", name: "to", type: "address" },
        { internalType: "uint256", name: "id", type: "uint256" },
        { internalType: "uint256", name: "amount", type: "uint256" },
        { internalType: "bytes", name: "data", type: "bytes" },
      ],
      name: "safeTransferFrom",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
    {
      inputs: [
        { internalType: "address", name: "operator", type: "address" },
        { internalType: "bool", name: "approved", type: "bool" },
      ],
      name: "setApprovalForAll",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
    {
      inputs: [{ internalType: "bytes4", name: "interfaceId", type: "bytes4" }],
      name: "supportsInterface",
      outputs: [{ internalType: "bool", name: "", type: "bool" }],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [{ internalType: "uint256", name: "id", type: "uint256" }],
      name: "uri",
      outputs: [{ internalType: "string", name: "", type: "string" }],
      stateMutability: "view",
      type: "function",
    },
  ];
  logsDecoder.addABI(abi);
  const decodedData = logsDecoder.decodeLogs([logs]);
  return decodedData;
}

function decodeERC721LogsData(logs) {
  const primaryWeb3Provider = new Web3(config.providerUrls[0]);

  logs.topics[1] = primaryWeb3Provider.eth.abi.decodeParameter(
    "address",
    logs.topics[1]
  );
  logs.topics[2] = primaryWeb3Provider.eth.abi.decodeParameter(
    "address",
    logs.topics[2]
  );
  return logs;
}
const sendMessageToGroups = (groupIds, messageText, botToken) => {
  return new Promise(async (resolve, reject) => {
    try {
      const bot = new Telegraf(botToken);

      // Helper function to send a message to a group
      const sendMessageToGroup = async (groupId, message) => {
        try {
          await bot.telegram.sendMessage(groupId, message);
          console.log(`Message sent to group ${groupId}`);
        } catch (error) {
          console.error(`Error sending message to group ${groupId}:`, error);
        }
      };

      // Send the message to all groupIds
      const promises = groupIds.map((groupId) =>
        sendMessageToGroup(groupId, messageText)
      );
      await Promise.all(promises);

      console.log("All messages sent");
      resolve();
    } catch (error) {
      reject(error);
    }
  });
};
