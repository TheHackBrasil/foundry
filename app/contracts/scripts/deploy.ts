import { ethers } from "hardhat";

async function main() {
  if (!process.env.ANCHOR_PRIVATE_KEY) {
    throw new Error(
      "ANCHOR_PRIVATE_KEY is not set. Export a funded Base Sepolia " +
        "private key before deploying."
    );
  }

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Network:  ${(await ethers.provider.getNetwork()).name}`);

  const anchor = await ethers.deployContract("FoundryAnchor");
  await anchor.waitForDeployment();
  const address = await anchor.getAddress();

  console.log(`FoundryAnchor deployed: ${address}`);
  console.log(`https://sepolia.basescan.org/address/${address}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
