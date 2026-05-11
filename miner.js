require("dotenv").config();

const { ethers } = require("ethers");

const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = "0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc";

const ABI = [
  "function getChallenge(address miner) view returns (bytes32)",
  "function miningState() view returns (uint256 era,uint256 reward,uint256 difficulty,uint256 minted,uint256 remaining,uint256 epoch,uint256 epochBlocksLeft_)",
  "function mine(uint256 nonce)"
];

const WORKERS = 1;
const STATS_UPDATE_MS = 1000;
const HASH_BATCH = 100000n;

let walletAddress = "";
let globalStartTime = Date.now();
let lastTxHash = "";
let lastBlockNumber = 0;

function requireEnv() {
  if (!RPC_URL || !PRIVATE_KEY) {
    console.error("Isi RPC_URL dan PRIVATE_KEY di file .env dulu.");
    console.error("Contoh: cp .env.example .env lalu edit PRIVATE_KEY.");
    process.exit(1);
  }

  if (!PRIVATE_KEY.startsWith("0x")) {
    console.error("PRIVATE_KEY harus diawali 0x.");
    process.exit(1);
  }
}

function randomNonce() {
  const high = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  const low = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  return (high << 32n) | low;
}

function formatHashrate(hps) {
  if (hps >= 1e9) return (hps / 1e9).toFixed(2) + " GH/s";
  if (hps >= 1e6) return (hps / 1e6).toFixed(2) + " MH/s";
  if (hps >= 1e3) return (hps / 1e3).toFixed(2) + " KH/s";
  return hps.toFixed(2) + " H/s";
}

function formatTime(totalSeconds) {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return "N/A";
  if (totalSeconds < 1) return "< 1s";
  if (totalSeconds < 60) return Math.floor(totalSeconds) + "s";
  if (totalSeconds < 3600) {
    const m = Math.floor(totalSeconds / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h}h ${m}m ${s}s`;
}

function formatNumber(n) {
  return n.toLocaleString("en-US");
}

function estimateETA(difficulty, hps) {
  if (hps <= 0 || difficulty <= 0n) return "N/A";

  const LOG10_2_POW_256 = 77.06368;
  const diffStr = difficulty.toString();
  const log10Diff = (diffStr.length - 1) + Math.log10(parseInt(diffStr[0], 10));
  const log10Expected = LOG10_2_POW_256 - log10Diff;
  const log10ETA = log10Expected - Math.log10(hps);
  const etaSeconds = Math.pow(10, log10ETA);

  if (!isFinite(etaSeconds) || etaSeconds < 0) return "N/A";
  return "~" + formatTime(etaSeconds);
}

function renderStats({ era, reward, difficulty, epoch, challenge, totalHashes, startTime }) {
  const elapsed = (Date.now() - globalStartTime) / 1000;
  const roundElapsed = (Date.now() - startTime) / 1000;
  const hps = roundElapsed > 0 ? Number(totalHashes) / roundElapsed : 0;
  const eta = estimateETA(difficulty, hps);
  const challengeShort = challenge.length > 20
    ? challenge.slice(0, 10) + "..." + challenge.slice(-8)
    : challenge;

  const txInfo = lastTxHash
    ? `${lastTxHash.slice(0, 16)}... (block ${lastBlockNumber})`
    : "-";

  return [
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  HASH256 CLI Miner",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `  Wallet:   ${walletAddress}`,
    `  Contract: ${CONTRACT_ADDRESS}`,
    "",
    `  Era:      ${era}`,
    `  Reward:   ${reward} HASH`,
    `  Epoch:    ${epoch}`,
    "",
    `  hashrate`,
    `  ${formatHashrate(hps)} x ${WORKERS} worker${WORKERS > 1 ? "s" : ""}`,
    "",
    `  ETA - current diff`,
    `  ${eta}`,
    "",
    `  hashes tried`,
    `  ${formatNumber(totalHashes)}`,
    "",
    `  elapsed`,
    `  ${formatTime(elapsed)}`,
    "",
    `  challenge`,
    `  ${challengeShort}`,
    "",
    `  tx`,
    `  ${txInfo}`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  ].join("\n");
}

async function main() {
  requireEnv();

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  walletAddress = wallet.address;

  console.log("HASH256 CLI Miner initialized");
  console.log("Wallet:", walletAddress);
  console.log("Contract:", CONTRACT_ADDRESS);
  console.log("Starting mining...\n");

  while (true) {
    let state, difficulty, challenge;
    try {
      state = await contract.miningState();
      difficulty = BigInt(state.difficulty.toString());
      challenge = await contract.getChallenge(wallet.address);
    } catch (err) {
      console.error("Failed to fetch mining state:", err.shortMessage || err.message);
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    const reward = ethers.formatUnits(state.reward, 18);
    const era = state.era.toString();
    const epoch = state.epoch.toString();

    let nonce = randomNonce();
    let totalHashes = 0n;
    const roundStartTime = Date.now();
    let challengeStaleCount = 0;
    let lastUpdate = Date.now();

    while (true) {
      const hash = ethers.solidityPackedKeccak256(
        ["bytes32", "uint256"],
        [challenge, nonce]
      );

      const hashNum = BigInt(hash);
      totalHashes++;

      if (hashNum < difficulty) {
        process.stdout.write("\x1Bc");
        console.log(renderStats({ era, reward, difficulty, epoch, challenge, totalHashes, startTime: roundStartTime }));
        console.log("\n  FOUND nonce:", nonce.toString());
        console.log("  Hash:", hash);

        try {
          const tx = await contract.mine(nonce, {
            gasLimit: 300000
          });
          lastTxHash = tx.hash;
          console.log("  TX sent:", tx.hash);

          const receipt = await tx.wait();
          lastBlockNumber = receipt.blockNumber;
          console.log("  Success block:", receipt.blockNumber);
        } catch (err) {
          console.error("  TX failed:", err.shortMessage || err.message);
          lastTxHash = "";
          lastBlockNumber = 0;
        }

        console.log("\n  Starting new round...\n");
        await new Promise(r => setTimeout(r, 2000));
        break;
      }

      nonce++;

      if (nonce % HASH_BATCH === 0n) {
        const now = Date.now();

        if (now - lastUpdate >= STATS_UPDATE_MS) {
          process.stdout.write("\x1Bc");
          console.log(renderStats({ era, reward, difficulty, epoch, challenge, totalHashes, startTime: roundStartTime }));
          lastUpdate = now;
        }

        challengeStaleCount++;
        if (challengeStaleCount >= 60) {
          challengeStaleCount = 0;
          try {
            const freshChallenge = await contract.getChallenge(wallet.address);
            if (freshChallenge !== challenge) {
              console.log("\n  Challenge changed, restarting round...");
              challenge = freshChallenge;
              nonce = randomNonce();
              totalHashes = 0n;
            }
          } catch (e) {}
        }
      }
    }
  }
}

process.on("SIGINT", () => {
  console.log("\n\nMiner stopped.");
  process.exit(0);
});

main().catch((err) => {
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
