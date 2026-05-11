# HASH256 CLI Miner

CLI miner untuk HASH256 dari `https://hash256.org/mine`.

Script ini mengambil challenge dari smart contract, mencari nonce yang memenuhi difficulty, lalu submit transaksi `mine(nonce)` ke Ethereum mainnet.

## Peringatan

- Mining ini memakai Ethereum mainnet.
- Wallet harus punya ETH untuk gas.
- Jangan pakai private key wallet utama. Lebih aman pakai wallet baru khusus mining.
- Jangan commit file `.env`.
- Verifikasi sendiri alamat kontrak sebelum mengirim transaksi: `https://etherscan.io/address/0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc`.

## Kebutuhan

- Ubuntu/VPS
- Node.js 18 atau lebih baru
- npm
- Wallet Ethereum
- Private key wallet
- ETH untuk gas
- RPC Ethereum mainnet

## Install Node.js dan npm

Kalau memakai user biasa Ubuntu:

```bash
cd ~

sudo apt update
sudo apt install -y curl ca-certificates gnupg

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs

node -v
npm -v
```

Kalau login sebagai root:

```bash
cd ~

apt update
apt install -y curl ca-certificates gnupg

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

node -v
npm -v
```

## Setup Project

```bash
git clone https://github.com/mrfunntastiic/hash256-cli
cd hash256-cli

npm install
cp .env.example .env
nano .env
```

Isi `.env`:

```env
RPC_URL=https://ethereum-rpc.publicnode.com
PRIVATE_KEY=0xPRIVATE_KEY_WALLET_KAMU
# Optional: set worker threads (default = CPU cores - 1)
WORKERS=4
```

Simpan di nano:

```text
CTRL + X
Y
Enter
```

## Cek State Kontrak

```bash
npm run check
```

Output akan menampilkan `genesisState` dan `miningState`.

## Jalankan Miner

```bash
npm start
```

Contoh output:

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  HASH256 CLI Miner
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Wallet:   0x...
  Contract: 0xAC7b...A0cc

  Era:      1
  Reward:   100.0 HASH
  Epoch:    42

  hashrate
  58.2 MH/s x 4 workers

  ETA - current diff
  ~1.2h

  hashes tried
  5,640,500,000

  elapsed
  594.9 s

  cpu
  85.4% / 8 cores (4 threads)

  challenge
  0x66489cfc...e41a63

  tx
  -
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  FOUND by worker 2!
  Nonce: 12345678901234567890
  Hash: 0x0000...
  TX sent: 0x...
  Success block: 12345678
```

## Error Umum

### `npm: command not found`

Node.js/npm belum terinstall.

```bash
sudo apt update
sudo apt install -y nodejs npm
```

Atau pakai NodeSource seperti instruksi install di atas.

### Permission denied saat `apt update`

Kamu bukan root.

```bash
sudo apt update
sudo apt install -y nodejs npm
```

### `Isi RPC_URL dan PRIVATE_KEY di file .env dulu`

File `.env` belum dibuat atau isinya belum benar.

```bash
cat .env
```

Harus ada:

```env
RPC_URL=...
PRIVATE_KEY=...
```

### `insufficient funds`

Wallet tidak punya ETH untuk gas. Isi ETH dulu ke wallet tersebut.

### `execution reverted`

Kemungkinan mining belum aktif, nonce tidak valid, atau state kontrak berubah. Jalankan ulang miner atau cek state kontrak.

### `InsufficientWork`

Nonce yang ditemukan tidak memenuhi difficulty saat transaksi diproses. Jalankan ulang miner.

### `GenesisNotComplete`

Mining belum dibuka oleh kontrak. Tunggu sampai genesis selesai.

## Konfigurasi Worker / CPU

Miner akan otomatis deteksi jumlah CPU core dan pakai `(cores - 1)` threads.

**Cek CPU yang terdeteksi:**

```bash
node -e "console.log(require('os').cpus().length + ' cores')"
```

**Atur manual jumlah worker di `.env`:**

```env
# Pakai semua core
WORKERS=8

# Pakai setengah core
WORKERS=4

# Single thread (mode hemat)
WORKERS=1
```

**Tips:**
- Kalau VPS murah / shared: pakai `WORKERS=1` atau `WORKERS=2`
- Kalau dedicated server: pakai `WORKERS=(cores - 1)`
- Jangan pakai `WORKERS` lebih dari jumlah CPU core
