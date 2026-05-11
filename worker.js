const { parentPort } = require("worker_threads");
const { ethers } = require("ethers");

let stopped = false;
let challenge = "";
let difficulty = 0n;
let nonce = 0n;
let totalHashes = 0n;
let workerId = 0;

const BATCH = 10_000;
const REPORT_EVERY = 5_000;

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
    // ethers.solidityPackedKeccak256 uses internal @noble/hashes (optimized)
    const hash = ethers.solidityPackedKeccak256(
      ["bytes32", "uint256"],
      [challenge, nonce]
    );
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
