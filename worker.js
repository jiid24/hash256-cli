const { parentPort } = require("worker_threads");
const { ethers } = require("ethers");

let stopped = false;
let challenge = "";
let difficulty = 0n;
let nonce = 0n;
let totalHashes = 0n;
let workerId = 0;

const BATCH = 50_000;
const REPORT_EVERY = 10_000;

parentPort.on("message", (msg) => {
  if (msg.type === "start") {
    challenge = msg.challenge;
    difficulty = BigInt(msg.difficulty);
    nonce = BigInt(msg.startNonce);
    workerId = msg.workerId;
    stopped = false;
    totalHashes = 0n;
    mineLoop();
  } else if (msg.type === "stop") {
    stopped = true;
  }
});

function fastKeccak(challengeHex, nonceVal) {
  // Equivalent to solidityPackedKeccak256(["bytes32","uint256"],[challenge,nonce])
  // abi.encodePacked(bytes32, uint256) = 32 bytes challenge + 32 bytes uint256 BE
  const nHex = nonceVal.toString(16).padStart(64, "0");
  const packed = challengeHex.slice(2) + nHex;
  return ethers.keccak256("0x" + packed);
}

function mineLoop() {
  if (stopped) {
    parentPort.postMessage({
      type: "stopped",
      totalHashes: totalHashes.toString(),
      workerId
    });
    return;
  }

  for (let i = 0; i < BATCH; i++) {
    const hash = fastKeccak(challenge, nonce);
    totalHashes++;

    if (BigInt(hash) < difficulty) {
      parentPort.postMessage({
        type: "found",
        nonce: nonce.toString(),
        hash,
        totalHashes: totalHashes.toString(),
        workerId
      });
      return;
    }

    nonce++;

    if (i % REPORT_EVERY === 0 && i > 0) {
      parentPort.postMessage({
        type: "progress",
        totalHashes: totalHashes.toString(),
        workerId
      });
    }
  }

  parentPort.postMessage({
    type: "progress",
    totalHashes: totalHashes.toString(),
    workerId
  });

  if (!stopped) {
    setImmediate(mineLoop);
  }
}
