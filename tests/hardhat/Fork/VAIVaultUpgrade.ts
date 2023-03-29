import { impersonateAccount, reset, setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Signer } from "ethers";
import { ethers } from "hardhat";

import { VAIVault, VAIVaultProxy__factory, VAIVault__factory } from "../../../typechain";

const hre = require("hardhat");
const FORK_MAINNET = process.env.FORK_MAINNET === "true";
let FORK_ENDPOINT;
const bigNumber18 = BigNumber.from("1000000000000000000"); // 1e18

// Address of the vault proxy
const vaultProxy = "0x0667Eed0a0aAb930af74a3dfeDD263A73994f216";
// vai vault user
const vaultUser = "0x37a1caf0330e1f72a3c4dbe65dc3b46961d4c299";
// Address of vault owner
const Owner = "0x939bd8d64c0a9583a7dcea9933f7b21697ab6396";
// Address of already deployed access control manager
const ACM = "0x4788629ABc6cFCA10F9f969efdEAa1cF70c23555";
// Owner of the ACM
const NORMAL_TIMELOCK = "0x939bD8d64c0A9583A7Dcea9933f7b21697ab6396";

let admin: Signer;
let impersonatedTimelock: Signer;
let signer: Signer;
let user1: SignerWithAddress;
let user2: SignerWithAddress;
let deployer: SignerWithAddress;
let vaiVault: ethers.Contract;
let oldVAIVault: ethers.Contract;
let accessControlManager: ethers.Contract;
let vai: ethers.Contract;
let xvs: ethers.Contract;
let vaiVaultFresh: VAIVault;

function getForkingUrl() {
  FORK_ENDPOINT = hre.network.config.forking.url;
}

async function deployAndConfigureNewVault() {
  /*
   *  Forking mainnet
   * */
  await impersonateAccount(Owner);
  admin = await ethers.getSigner(Owner);
  await impersonateAccount(NORMAL_TIMELOCK);
  impersonatedTimelock = await ethers.getSigner(NORMAL_TIMELOCK);
  await setBalance(NORMAL_TIMELOCK, ethers.utils.parseEther("2"));

  const vaiVaultProxy = VAIVaultProxy__factory.connect(vaultProxy, admin);

  const vaiVaultFactory = await ethers.getContractFactory("contracts/Vault/VAIVault.sol:VAIVault");
  const vaiVaultImpl = await vaiVaultFactory.deploy();
  await vaiVaultImpl.deployed();

  await vaiVaultProxy.connect(admin)._setPendingImplementation(vaiVaultImpl.address);
  await vaiVaultImpl.connect(admin)._become(vaiVaultProxy.address);
  vaiVault = VAIVault__factory.connect(vaiVaultProxy.address, admin);

  await vaiVault._setAccessControl(ACM);
  accessControlManager = await ethers.getContractAt(
    "contracts/Governance/IAccessControlManager.sol:IAccessControlManager",
    ACM,
    Owner,
  );
}

async function grantPermissions() {
  let tx = await accessControlManager
    .connect(impersonatedTimelock)
    .giveCallPermission(vaiVault.address, "pause()", Owner);
  await tx.wait();

  tx = await accessControlManager.connect(impersonatedTimelock).giveCallPermission(vaiVault.address, "resume()", Owner);
  await tx.wait();

  tx = await accessControlManager
    .connect(impersonatedTimelock)
    .giveCallPermission(vaiVault.address, "add(address,uint256,address,uint256,uint256)", Owner);
  await tx.wait();

  tx = await accessControlManager
    .connect(impersonatedTimelock)
    .giveCallPermission(vaiVault.address, "set(address,uint256,uint256)", Owner);
  await tx.wait();
}

async function deployAndConfigureOldVault() {
  /*
   *  Forking mainnet
   * */
  await impersonateAccount(Owner);
  admin = await ethers.getSigner(Owner);

  const vaiVaultProxy = VAIVaultProxy__factory.connect(vaultProxy, admin);
  oldVAIVault = VAIVault__factory.connect(vaiVaultProxy.address, admin);
}

async function deployFreshVaultFixture() {
  [deployer, user1, user2] = await ethers.getSigners();

  const VaiVaultFactory = await ethers.getContractFactory("VAIVault");
  vaiVaultFresh = await VaiVaultFactory.deploy();

  const vaiFactory = await ethers.getContractFactory("VAI");
  vai = await vaiFactory.deploy(1);

  const xvsFactory = await ethers.getContractFactory("XVS");
  xvs = await xvsFactory.deploy(deployer.address);

  await vaiVaultFresh._setAccessControl(ACM);
}

async function sendGasCost() {
  /**
   *  sending gas cost to owner
   * */
  [signer] = await ethers.getSigners();
  console.log("-- Sending gas cost to owner addr --");
  await signer.sendTransaction({
    to: Owner,
    value: ethers.BigNumber.from("900081987000000000"),
    data: undefined,
  });
}

describe("VAIVault", async () => {
  before(async () => {
    getForkingUrl();
    await reset(`${FORK_ENDPOINT}`, 26850561);
    await sendGasCost();
    await deployAndConfigureOldVault();
    await deployAndConfigureNewVault();
    await grantPermissions();
    await deployFreshVaultFixture();
  });
  if (FORK_MAINNET) {
    it("Verify states after upgrade", async () => {
      // Save all states before upgrade
      // Note : More states are covered in another test case `hardhat/XVS/XVSVaultFix.ts`
      const xvsV1 = await oldVAIVault.xvs();
      const vaiV1 = await oldVAIVault.vai();
      const xvsBalanceV1 = await oldVAIVault.xvsBalance();
      const accXVSPerShareV1 = await oldVAIVault.accXVSPerShare();
      const pendingRewardsV1 = await oldVAIVault.pendingRewards();
      const userInfoV1 = await oldVAIVault.userInfo(vaultUser);

      const xvsV2 = await vaiVault.xvs();
      const vaiV2 = await vaiVault.vai();
      const xvsBalanceV2 = await vaiVault.xvsBalance();
      const accXVSPerShareV2 = await vaiVault.accXVSPerShare();
      const pendingRewardsV2 = await vaiVault.pendingRewards();
      const userInfoV2 = await vaiVault.userInfo(vaultUser);

      expect(xvsV1).equals(xvsV2);
      expect(vaiV1).equals(vaiV2);
      expect(xvsBalanceV1).equals(xvsBalanceV2);
      expect(accXVSPerShareV1).equals(accXVSPerShareV2);
      expect(pendingRewardsV1).equals(pendingRewardsV2);
      expect(userInfoV1.amount).equals(userInfoV2.amount);
      expect(userInfoV1.rewardDebt).equals(userInfoV2.rewardDebt);
    });

    it("Revert when permission is not granted for pause and resume", async () => {
      await expect(vaiVault.connect(signer).pause()).to.be.revertedWithCustomError(vaiVault, "Unauthorized");
      await expect(vaiVault.connect(signer).resume()).to.be.revertedWithCustomError(vaiVault, "Unauthorized");
    });

    it("Success when permission is granted for pause and resume", async () => {
      await expect(vaiVault.connect(admin).pause()).to.emit(vaiVault, "VaultPaused");
      expect(await vaiVault.vaultPaused()).equals(true);

      await expect(vaiVault.connect(admin).resume()).to.emit(vaiVault, "VaultResumed");
      expect(await vaiVault.vaultPaused()).equals(false);
    });

    it("claim reward", async function () {
      // Grant permission to fresh vault
      let tx = await accessControlManager
        .connect(impersonatedTimelock)
        .giveCallPermission(vaiVaultFresh.address, "pause()", Owner);
      await tx.wait();

      tx = await accessControlManager
        .connect(impersonatedTimelock)
        .giveCallPermission(vaiVaultFresh.address, "resume()", Owner);
      await tx.wait();

      await vaiVaultFresh.setVenusInfo(xvs.address, vai.address);
      await vai.mint(user1.address, bigNumber18.mul(100));
      await vai.mint(user2.address, bigNumber18.mul(100));

      expect(await vai.balanceOf(user1.address)).to.be.equal(bigNumber18.mul(100));
      await vai.connect(user1).approve(vaiVaultFresh.address, bigNumber18.mul(100));

      // Revert when vault is paused
      await expect(vaiVaultFresh.connect(admin).pause()).to.emit(vaiVaultFresh, "VaultPaused");
      await expect(vaiVaultFresh.connect(user1).deposit(bigNumber18.mul(100))).to.revertedWith("Vault is paused");
      await expect(vaiVaultFresh.connect(admin).resume()).to.emit(vaiVaultFresh, "VaultResumed");

      await vaiVaultFresh.connect(user1).deposit(bigNumber18.mul(100));

      await vai.connect(user2).approve(vaiVaultFresh.address, bigNumber18.mul(100));
      await vaiVaultFresh.connect(user2).deposit(bigNumber18.mul(100));

      await xvs.transfer(vaiVaultFresh.address, bigNumber18.mul(50));

      await vaiVaultFresh.updatePendingRewards();

      // Revert when vault is paused
      await expect(vaiVaultFresh.connect(admin).pause()).to.emit(vaiVaultFresh, "VaultPaused");
      await expect(vaiVaultFresh.connect(user1).withdraw(1)).to.revertedWith("Vault is paused");
      await expect(vaiVaultFresh.connect(admin).resume()).to.emit(vaiVaultFresh, "VaultResumed");
      await vaiVaultFresh.connect(user1).withdraw(1);

      expect(await xvs.balanceOf(user1.address)).to.be.equal(bigNumber18.mul(25));
      expect(await xvs.balanceOf(user2.address)).to.be.equal(bigNumber18.mul(0));

      expect(await vaiVaultFresh.pendingXVS(user2.address)).to.be.equal(bigNumber18.mul(25));
      expect(await vaiVaultFresh.pendingXVS(user1.address)).to.be.equal(bigNumber18.mul(0));

      // Revert when vault is paused
      await expect(vaiVaultFresh.connect(admin).pause()).to.emit(vaiVaultFresh, "VaultPaused");
      await expect(vaiVaultFresh.connect(user2)["claim()"]()).to.revertedWith("Vault is paused");
      await expect(vaiVaultFresh.connect(admin).resume()).to.emit(vaiVaultFresh, "VaultResumed");

      await vaiVaultFresh.connect(user2)["claim()"]();
      expect(await xvs.balanceOf(user2.address)).to.be.equal(bigNumber18.mul(25));
    });
  }
});