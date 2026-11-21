import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Required env vars (read lazily; never committed to the repo):
//   BASE_SEPOLIA_RPC_URL  - RPC endpoint for Base Sepolia.
//                           Default: https://sepolia.base.org
//   ANCHOR_PRIVATE_KEY    - funded testnet deployer/anchor key.
//                           Only needed for `npm run deploy`; local
//                           compile and test work without any key.

const anchorPrivateKey = process.env.ANCHOR_PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {},
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
      chainId: 84532,
      accounts: anchorPrivateKey ? [anchorPrivateKey] : [],
    },
  },
};

export default config;
