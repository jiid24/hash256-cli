const { parentPort } = require("worker_threads");
const { ethers } = require("ethers");

let stopped = false;
let challenge = "";
let difficulty = 0n;
let nonce = 0n;
let totalHashes = 0n;
let workerId = 0;

parentPort.on("message", (msg) => {
  if (msg.type === "start") {
    challenge = msg.challenge;
    difficulty = BigInt(msg.difficulty);
    nonce = BigInt(msg.startNonce);
    workerId = msg.workerId;
    stopped = false;
    totalHashes = 0n;
    mineBatch();
  } else if (msg.type === "stop") {
    stopped = true;
  }
});

function mineBatch() {
  const batchSize = 5_000_000;

  for (let i = 0; i < batchSize; i++) {
    if (stopped) {
      parentPort.postMessage({
        type: "stopped",
        totalHashes: totalHashes.toString(),
        workerId
      });
      return;
    }

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
  }

  parentPort.postMessage({
    type: "progress",
    totalHashes: totalHashes.toString(),
    workerId
  });

  if (!stopped) {
    setImmediate(mineBatch);
  }
}
