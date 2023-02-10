import { FakeContract, MockContract, smock } from "@defi-wonderland/smock";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { BigNumber } from "ethers";
import { getAddress, keccak256, parseUnits, solidityPack } from "ethers/lib/utils";
import { ethers, upgrades } from "hardhat";

import {
  FaucetToken,
  FaucetToken__factory,
  IPancakePair,
  IPancakeSwapV2Factory,
  IWBNB,
  SwapRouter,
  SwapRouter__factory,
  VBep20Immutable,
  WBNB,
  WBNB__factory,
} from "../../../typechain";
import { EIP20Interface } from "./../../../typechain/contracts/Tokens/EIP20Interface";

const { expect } = chai;
chai.use(smock.matchers);

const SWAP_AMOUNT = parseUnits("100", 18);
const MIN_AMOUNT_OUT = parseUnits("90", 18);
const DEFAULT_RESERVE = parseUnits("1000", 18);

type SwapFixture = {
  vToken: FakeContract<VBep20Immutable>;
  wBNB: MockContract<WBNB>;
  tokenA: MockContract<FaucetToken>;
  tokenB: MockContract<FaucetToken>;
  swapRouter: MockContract<SwapRouter>;
  pancakeFactory: FakeContract<IPancakeSwapV2Factory>;
  tokenPair: FakeContract<IPancakePair>;
  wBnbPair: FakeContract<IPancakePair>;
};

async function deploySwapContract(): Promise<SwapFixture> {
  const vToken = await smock.fake<VBep20Immutable>("VBep20Immutable");
  const wBNBFactory = await smock.mock<WBNB__factory>("WBNB");
  const wBNB = await wBNBFactory.deploy();
  const pancakeFactory = await smock.fake<IPancakeSwapV2Factory>("IPancakeSwapV2Factory");

  const SwapRouter = await smock.mock<SwapRouter__factory>("SwapRouter");
  const swapRouter = await upgrades.deployProxy(SwapRouter, [], {
    constructorArgs: [wBNB.address, pancakeFactory.address],
  });

  const FaucetToken = await smock.mock<FaucetToken__factory>("FaucetToken");
  const tokenA = await FaucetToken.deploy(parseUnits("10000", 18), "TOKENA", 18, "A");
  const tokenB = await FaucetToken.deploy(parseUnits("10000", 18), "TOKENB", 18, "B");

  //Calculate tokenPair address
  let create2Address = getCreate2Address(pancakeFactory.address, [tokenA.address, tokenB.address]);
  const tokenPair = await smock.fake<IPancakePair>("IPancakePair", { address: create2Address.toLocaleLowerCase() });

  //Calculate wBNB pair address
  create2Address = getCreate2Address(pancakeFactory.address, [wBNB.address, tokenB.address]);
  const wBnbPair = await smock.fake<IPancakePair>("IPancakePair", { address: create2Address.toLocaleLowerCase() });

  return { swapRouter, wBNB, vToken, tokenA, tokenB, pancakeFactory, tokenPair, wBnbPair };
}

async function configure(fixture: SwapFixture, user: SignerWithAddress) {
  const { tokenPair, wBnbPair, tokenA, swapRouter, wBNB } = fixture;
  tokenPair.getReserves.returns({
    reserve0: DEFAULT_RESERVE,
    reserve1: DEFAULT_RESERVE,
    blockTimestampLast: 0,
  });
  wBnbPair.getReserves.returns({
    reserve0: DEFAULT_RESERVE,
    reserve1: DEFAULT_RESERVE,
    blockTimestampLast: 0,
  });
  await tokenA.allocateTo(user.address, SWAP_AMOUNT);
  await tokenA.allocateTo(tokenPair.address, DEFAULT_RESERVE);
  await wBNB.connect(user).setBalanceOf(wBnbPair.address, DEFAULT_RESERVE);
  await tokenA.connect(user).approve(swapRouter.address, SWAP_AMOUNT);
  wBNB.transfer.returns(true);
}

function getCreate2Address(factoryAddress: string, [tokenA, tokenB]: [string, string]): string {
  const [token0, token1] = BigNumber.from(tokenA).lt(BigNumber.from(tokenB)) ? [tokenA, tokenB] : [tokenB, tokenA];
  const create2Inputs = [
    "0xff",
    factoryAddress,
    keccak256(solidityPack(["address", "address"], [token0, token1])),
    "0x00fb7f630766e6a796048ea87d01acd3068e8ff67d078148a3fa3f4a84f69bd5", //IPairBytecode Hash
  ];
  const sanitizedInputs = `0x${create2Inputs.map(i => i.slice(2)).join("")}`;
  return getAddress(`0x${keccak256(sanitizedInputs).slice(-40)}`);
}

async function getValidDeadline(): Promise<number> {
  // getting timestamp
  const blockNumBefore = await ethers.provider.getBlockNumber();
  const blockBefore = await ethers.provider.getBlock(blockNumBefore);
  return blockBefore.timestamp + 1;
}

describe("Swap Contract", () => {
  let user: SignerWithAddress;
  let vToken: FakeContract<VBep20Immutable>;
  let wBNB: FakeContract<IWBNB>;
  let swapRouter: MockContract<SwapRouter>;
  let tokenA: FakeContract<EIP20Interface>;
  let tokenB: FakeContract<EIP20Interface>;

  beforeEach(async () => {
    [, user] = await ethers.getSigners();
    const contracts = await loadFixture(deploySwapContract);
    await configure(contracts, user);
    ({ vToken, wBNB, swapRouter, tokenA, tokenB } = contracts);
  });

  describe("Swap", () => {
    it("revert if deadline has passed", async () => {
      await expect(
        swapRouter.swapExactTokensForTokens(
          SWAP_AMOUNT,
          MIN_AMOUNT_OUT,
          [tokenA.address, tokenB.address],
          user.address,
          0,
        ),
      ).to.be.revertedWithCustomError(swapRouter, "SwapDeadlineExpire");
    });

    it("should swap tokenA -> tokenB", async () => {
      const deadline = await getValidDeadline();
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      await expect(
        swapRouter
          .connect(user)
          .swapExactTokensForTokens(
            SWAP_AMOUNT,
            MIN_AMOUNT_OUT,
            [tokenA.address, tokenB.address],
            user.address,
            deadline,
          ),
      ).to.emit(swapRouter, "SwapTokensForTokens");
    });

    it("should swap BNB -> token", async () => {
      const deadline = await getValidDeadline();
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      await expect(
        swapRouter
          .connect(user)
          .swapExactETHForTokens(MIN_AMOUNT_OUT, [wBNB.address, tokenB.address], user.address, deadline, {
            value: SWAP_AMOUNT,
          }),
      ).to.emit(swapRouter, "SwapBnbForTokens");
    });

    it("revert if deadline has passed at supporting fee", async () => {
      await expect(
        swapRouter.swapExactTokensForTokensAtSupportingFee(
          SWAP_AMOUNT,
          MIN_AMOUNT_OUT,
          [tokenA.address, tokenB.address],
          user.address,
          0,
        ),
      ).to.be.revertedWithCustomError(swapRouter, "SwapDeadlineExpire");
    });

    it("should swap tokenA -> tokenB  at supporting fee", async () => {
      const deadline = await getValidDeadline();
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      await expect(
        swapRouter
          .connect(user)
          .swapExactTokensForTokensAtSupportingFee(
            SWAP_AMOUNT,
            MIN_AMOUNT_OUT,
            [tokenA.address, tokenB.address],
            user.address,
            deadline,
          ),
      ).to.emit(swapRouter, "SwapTokensForTokens");
    });

    it("should swap BNB -> token  at supporting fee", async () => {
      const deadline = await getValidDeadline();
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      await expect(
        swapRouter
          .connect(user)
          .swapExactETHForTokensAtSupportingFee(
            MIN_AMOUNT_OUT,
            [wBNB.address, tokenB.address],
            user.address,
            deadline,
            {
              value: SWAP_AMOUNT,
            },
          ),
      ).to.emit(swapRouter, "SwapBnbForTokens");
    });
  });

  describe("Supply", () => {
    it("revert if deadline has passed", async () => {
      await expect(
        swapRouter.swapAndSupply(vToken.address, SWAP_AMOUNT, MIN_AMOUNT_OUT, [tokenA.address, tokenB.address], 0),
      ).to.be.revertedWithCustomError(swapRouter, "SwapDeadlineExpire");
    });

    it("swap tokenA -> tokenB --> supply tokenB", async () => {
      const deadline = await getValidDeadline();
      await expect(
        swapRouter
          .connect(user)
          .swapAndSupply(vToken.address, SWAP_AMOUNT, MIN_AMOUNT_OUT, [tokenA.address, tokenB.address], deadline),
      ).to.emit(swapRouter, "SupplyOnBehalf");
    });

    it("swap BNB -> token --> supply token", async () => {
      const deadline = await getValidDeadline();
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      await expect(
        swapRouter
          .connect(user)
          .swapBnbAndSupply(vToken.address, MIN_AMOUNT_OUT, [wBNB.address, tokenB.address], deadline, {
            value: SWAP_AMOUNT,
          }),
      ).to.emit(swapRouter, "SupplyOnBehalf");
    });

    it("revert if deadline has passed  at supporting fee", async () => {
      await expect(
        swapRouter.swapAndSupplyAtSupportingFee(
          vToken.address,
          SWAP_AMOUNT,
          MIN_AMOUNT_OUT,
          [tokenA.address, tokenB.address],
          0,
        ),
      ).to.be.revertedWithCustomError(swapRouter, "SwapDeadlineExpire");
    });

    it("swap tokenA -> tokenB --> supply tokenB at supporting fee", async () => {
      const deadline = await getValidDeadline();
      await expect(
        swapRouter
          .connect(user)
          .swapAndSupplyAtSupportingFee(
            vToken.address,
            SWAP_AMOUNT,
            MIN_AMOUNT_OUT,
            [tokenA.address, tokenB.address],
            deadline,
          ),
      ).to.emit(swapRouter, "SupplyOnBehalf");
    });

    it("swap BNB -> token --> supply token at supporting fee", async () => {
      const deadline = await getValidDeadline();
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      await expect(
        swapRouter
          .connect(user)
          .swapBnbAndSupplyAtSupportingFee(vToken.address, MIN_AMOUNT_OUT, [wBNB.address, tokenB.address], deadline, {
            value: SWAP_AMOUNT,
          }),
      ).to.emit(swapRouter, "SupplyOnBehalf");
    });
  });

  describe("Repay", () => {
    it("revert if deadline has passed", async () => {
      await expect(
        swapRouter.swapAndRepay(vToken.address, SWAP_AMOUNT, MIN_AMOUNT_OUT, [tokenA.address, tokenB.address], 0),
      ).to.be.revertedWithCustomError(swapRouter, "SwapDeadlineExpire");
    });

    it("swap tokenA -> tokenB --> supply tokenB", async () => {
      const deadline = await getValidDeadline();
      await expect(
        swapRouter
          .connect(user)
          .swapAndRepay(vToken.address, SWAP_AMOUNT, MIN_AMOUNT_OUT, [tokenA.address, tokenB.address], deadline),
      ).to.emit(swapRouter, "RepayOnBehalf");
    });

    it("swap BNB -> token --> supply token", async () => {
      const deadline = await getValidDeadline();
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      await expect(
        swapRouter
          .connect(user)
          .swapBnbAndRepay(vToken.address, MIN_AMOUNT_OUT, [wBNB.address, tokenB.address], deadline, {
            value: SWAP_AMOUNT,
          }),
      ).to.emit(swapRouter, "RepayOnBehalf");
    });

    it("revert if deadline has passed at supporting fee", async () => {
      await expect(
        swapRouter.swapAndRepayAtSupportingFee(
          vToken.address,
          SWAP_AMOUNT,
          MIN_AMOUNT_OUT,
          [tokenA.address, tokenB.address],
          0,
        ),
      ).to.be.revertedWithCustomError(swapRouter, "SwapDeadlineExpire");
    });

    it("swap tokenA -> tokenB --> supply tokenB at supporting fee", async () => {
      const deadline = await getValidDeadline();
      await expect(
        swapRouter
          .connect(user)
          .swapAndRepayAtSupportingFee(
            vToken.address,
            SWAP_AMOUNT,
            MIN_AMOUNT_OUT,
            [tokenA.address, tokenB.address],
            deadline,
          ),
      ).to.emit(swapRouter, "RepayOnBehalf");
    });

    it("swap BNB -> token --> supply token at supporting fee", async () => {
      const deadline = await getValidDeadline();
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      await expect(
        swapRouter
          .connect(user)
          .swapBnbAndRepayAtSupportingFee(vToken.address, MIN_AMOUNT_OUT, [wBNB.address, tokenB.address], deadline, {
            value: SWAP_AMOUNT,
          }),
      ).to.emit(swapRouter, "RepayOnBehalf");
    });
  });
});