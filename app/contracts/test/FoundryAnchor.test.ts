import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const ROOT = ethers.keccak256(ethers.toUtf8Bytes("foundry-merkle-root-1"));

async function deployFixture() {
  const [owner, other] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("FoundryAnchor");
  const anchor = await factory.deploy();
  await anchor.waitForDeployment();
  return { anchor, owner, other };
}

describe("FoundryAnchor", function () {
  it("emits Anchored with the root, the sender and the timestamp", async function () {
    const { anchor, owner } = await deployFixture();
    await expect(anchor.anchor(ROOT))
      .to.emit(anchor, "Anchored")
      .withArgs(ROOT, owner.address, anyValue);
  });

  it("get() returns the stored first-seen timestamp", async function () {
    const { anchor } = await deployFixture();
    const tx = await anchor.anchor(ROOT);
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt!.blockNumber);
    expect(await anchor.get(ROOT)).to.equal(block!.timestamp);
  });

  it("get() returns 0 for a root that was never anchored", async function () {
    const { anchor } = await deployFixture();
    const unknown = ethers.keccak256(ethers.toUtf8Bytes("never-seen"));
    expect(await anchor.get(unknown)).to.equal(0);
  });

  it("does not overwrite the first timestamp on re-anchor", async function () {
    const { anchor } = await deployFixture();
    await (await anchor.anchor(ROOT)).wait();
    const first = await anchor.get(ROOT);
    expect(first).to.be.greaterThan(0);

    await time.increase(3600);
    await (await anchor.anchor(ROOT)).wait();

    expect(await anchor.get(ROOT)).to.equal(first);
  });
});
