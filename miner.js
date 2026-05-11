require("dotenv").config();

const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");
const { ethers } = require("ethers");

const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = "0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc";

const ABI = [
  "function getChallenge(address miner) view returns (bytes32)",
  "function miningState() view returns (uint256 era,uint256 reward,uint256 difficulty,uint256 minted,uint256 remaining,uint256 epoch,uint256 epochBlocksLeft_)",
  "function mine(uint256 nonce)"
];

const CPU_CORES = os.cpus().length;
const WORKERS = process.env.WORKERS
  ? Math.min(Math.max(parseInt(process.env.WORKERS) || 1, 1), CPU_CORES)
  : Math.max(1, CPU_CORES - 1);
const STATS_UPDATE_MS = 1000;

let walletAddress = "";
let globalStartTime = Date.now();
let lastTxHash = "";
let lastBlockNumber = 0;
let processStartUsage = process.cpuUsage();

const activeWorkers = [];
const workerStats = new Map();
let totalHashesGlobal = 0n;
let roundStartTime = Date.now();
let lastUpdate = Date.now();
let pendingResolve = null;

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

function getCpuPercent() {
  const usage = process.cpuUsage(processStartUsage);
  const user = usage.user / 1000;
  const sys = usage.system / 1000;
  const elapsedMs = Date.now() - globalStartTime;
  if (elapsedMs <= 0) return 0;
  const percent = ((user + sys) / elapsedMs) * 100;
  return Math.min(percent, 100 * CPU_CORES).toFixed(1);
}

function renderStats({ era, reward, difficulty, epoch, challenge }) {
  const elapsed = (Date.now() - globalStartTime) / 1000;
  const roundElapsed = (Date.now() - roundStartTime) / 1000;
  const hps = roundElapsed > 0 ? Number(totalHashesGlobal) / roundElapsed : 0;
  const eta = estimateETA(difficulty, hps);
  const challengeShort = challenge.length > 20
    ? challenge.slice(0, 10) + "..." + challenge.slice(-8)
    : challenge;
  const txInfo = lastTxHash
    ? `${lastTxHash.slice(0, 16)}... (block ${lastBlockNumber})`
    : "-";
  const cpuPercent = Math.min(parseFloat(getCpuPercent()) / CPU_CORES, 100).toFixed(1);

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
    `  ${formatNumber(totalHashesGlobal)}`,
    "",
    `  elapsed`,
    `  ${formatTime(elapsed)}`,
    "",
    `  cpu`,
    `  ${cpuPercent}% / ${CPU_CORES} cores (${WORKERS} threads)`,
    "",
    `  challenge`,
    `  ${challengeShort}`,
    "",
    `  tx`,
    `  ${txInfo}`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  ].join("\n");
}

function spawnWorkers(challenge, difficulty) {
  pendingResolve = null;

  for (let i = 0; i < WORKERS; i++) {
    const worker = new Worker(path.join(__dirname, "worker.js"));
    workerStats.set(i, 0n);

    worker.on("message", (msg) => {
      if (msg.type === "found") {
        if (pendingResolve) {
          pendingResolve(msg);
          pendingResolve = null;
        }
      } else if (msg.type === "progress") {
        workerStats.set(msg.workerId, BigInt(msg.totalHashes));
        let total = 0n;
        for (const h of workerStats.values()) {
          total += h;
        }
        totalHashesGlobal = total;
      } else if (msg.type === "stopped") {
        workerStats.set(msg.workerId, BigInt(msg.totalHashes));
      }
    });

    worker.on("error", (err) => {
      console.error(`Worker ${i} error:`, err.message);
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        console.error(`Worker ${i} exited with code ${code}`);
      }
    });

    worker.postMessage({
      type: "start",
      challenge,
      difficulty: difficulty.toString(),
      startNonce: randomNonce().toString(),
      workerId: i
    });

    activeWorkers.push(worker);
  }
}

function stopAllWorkers() {
  activeWorkers.forEach((w) => w.postMessage({ type: "stop" }));
  setTimeout(() => {
    while (activeWorkers.length > 0) {
      const w = activeWorkers.pop();
      w.terminate();
    }
  }, 800);
}

async function main() {
  requireEnv();

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
  walletAddress = wallet.address;

  console.log("HASH256 CLI Miner initialized");
  console.log(`Wallet: ${walletAddress}`);
  console.log(`Contract: ${CONTRACT_ADDRESS}`);
  console.log(`CPU: ${CPU_CORES} cores detected, using ${WORKERS} workers\n`);
  console.log("Starting mining...\n");

  while (true) {
    let state, difficulty, challenge;
    try {
      state = await contract.miningState();
      difficulty = BigInt(state.difficulty.toString());
      challenge = await contract.getChallenge(wallet.address);
    } catch (err) {
      console.error("Failed to fetch mining state:", err.shortMessage || err.message);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    const reward = ethers.formatUnits(state.reward, 18);
    const era = state.era.toString();
    const epoch = state.epoch.toString();

    roundStartTime = Date.now();
    totalHashesGlobal = 0n;
    workerStats.clear();
    lastUpdate = Date.now();

    spawnWorkers(challenge, difficulty);

    const statsInterval = setInterval(() => {
      const now = Date.now();
      if (now - lastUpdate >= STATS_UPDATE_MS) {
        process.stdout.write("\x1Bc");
        console.log(renderStats({ era, reward, difficulty, epoch, challenge }));
        lastUpdate = now;
      }
    }, STATS_UPDATE_MS);

    const result = await new Promise((resolve) => {
      pendingResolve = resolve;
    });

    clearInterval(statsInterval);
    stopAllWorkers();

    process.stdout.write("\x1Bc");
    console.log(renderStats({ era, reward, difficulty, epoch, challenge }));
    console.log(`\n  FOUND by worker ${result.workerId}!`);
    console.log("  Nonce:", result.nonce);
    console.log("  Hash:", result.hash);

    try {
      const tx = await contract.mine(result.nonce, { gasLimit: 300000 });
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
    await new Promise((r) => setTimeout(r, 2000));
  }
}

process.on("SIGINT", () => {
  console.log("\n\nMiner stopped.");
  stopAllWorkers();
  process.exit(0);
});

main().catch((err) => {
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
