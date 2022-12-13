pragma solidity 0.8.13;

import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "./interfaces/IPancakeSwapV2Router.sol";
import "./interfaces/IVtoken.sol";
import "./interfaces/IWBNB.sol";
import "./lib/TransferHelper.sol";
import "./lib/PancakeLibrary.sol";

/**
 * @title Venus's Pancake Swap Integration Contract
 * @notice This contracts allows users to swap a token for another one and supply/repay with the latter.
 * @dev For all functions that do not swap native BNB, user must approve this contract with the amount, prior the calling the swap function.
 * @author 0xlucian
 */

contract SwapRouter is Ownable2StepUpgradeable, IPancakeSwapV2Router {
    address public WBNB;
    address public factory;

    // ***************
    // ** MODIFIERS **
    // ***************

    modifier ensure(uint256 deadline) {
        if (deadline < block.timestamp) {
            revert SwapDeadlineExpire(deadline, block.timestamp);
        }
        _;
    }

    // **************
    // *** EVENTS ***
    // **************

    ///@notice This event is emitted whenever a successful supply on behalf of the user occurs
    event SupplyOnBehalf(address indexed supplier, address indexed vTokenAddress, uint256 indexed amount);

    ///@notice This event is emitted whenever a successful repay on behalf of the user occurs
    event RepayOnBehalf(address indexed repayer, address indexed vTokenAddress, uint256 indexed amount);

    // **************
    // *** ERRORS ***
    // **************

    ///@notice Error indicating that suplying to a given market failed.
    error SupplyError(address supplier, address vToken, uint256 errorCode);

    ///@notice Error indicating that repaying to given market failed.
    error RepayError(address repayer, address vToken, uint256 errorCode);

    ///@notice Error indicating wBNB address passed is not the expected one.
    error WrongAddress(address expectedAdddress, address passedAddress);

    ///@notice Error thrown when deadline for swap has expired
    error SwapDeadlineExpire(uint256 deadline, uint256 currentBlock);

    // *********************
    // **** CONSTRUCTOR ****
    // *********************

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Note that the contract is upgradeable. Use initialize() or reinitializers
        // to set the state variables.
        _disableInitializers();
    }

    // *********************
    // **** INITIALIZE *****
    // *********************
    function initialize(address WBNB_, address factory_) public initializer {
        require(WBNB != address(0), "Swap: wBNB address invalid");
        require(factory != address(0), "Swap: Pancake swap address invalid");
        __Ownable2Step_init();
        WBNB = WBNB_;
        factory = factory_;
    }

    // ****************************
    // **** EXTERNAL FUNCTIONS ****
    // ****************************

    /**
     * @notice Swap token A for token B and supplies to a Venus Market
     * @param vTokenAddress The address of the vToken contract to supply assets in.
     * @param amountIn The amount of tokens to swap.
     * @param amountOutMin Minimum amount of tokens to receive.
     * @param path Array with addresses of the underlying assets to be swapped
     * @dev Addresses of underlying assets should be ordered that first asset is the token we are swapping and second asset is the token we receive
     */
    function swapAndSupply(
        address vTokenAddress,
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external override ensure(deadline) {
        uint256[] memory swapAmounts = _swapExactTokensForTokens(amountIn, amountOutMin, path, msg.sender);
        TransferHelper.safeApprove(path[1], vTokenAddress, 0);
        TransferHelper.safeApprove(path[1], vTokenAddress, swapAmounts[1]);
        uint256 response = IVToken(vTokenAddress).mintBehalf(msg.sender, swapAmounts[1]);
        if (response != 0) {
            revert SupplyError(msg.sender, vTokenAddress, response);
        } else {
            emit SupplyOnBehalf(msg.sender, vTokenAddress, swapAmounts[1]);
        }
    }

    /**
     * @notice Swap BNB for another token and supplies to a Venus Market
     * @dev The amount to be swapped is obtained from the msg.value, since we are swapping BNB
     * @param vTokenAddress The address of the vToken contract to supply assets in.
     * @param amountOutMin Minimum amount of tokens to receive.
     * @param path Array with addresses of the underlying assets to be swapped
     * @dev Addresses of underlying assets should be ordered that first asset is the token we are swapping and second asset is the token we receive
     * @dev In case of swapping native BNB the first asset in path array should be the wBNB address
     */
    function swapBnbAndSupply(
        address vTokenAddress,
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external payable override ensure(deadline) {
        uint256[] memory swapAmounts = _swapExactETHForTokens(amountOutMin, path, msg.sender);
        TransferHelper.safeApprove(path[1], vTokenAddress, 0);
        TransferHelper.safeApprove(path[1], vTokenAddress, swapAmounts[1]);
        uint256 response = IVToken(vTokenAddress).mintBehalf(msg.sender, swapAmounts[1]);
        if (response != 0) {
            revert SupplyError(msg.sender, vTokenAddress, response);
        } else {
            emit SupplyOnBehalf(msg.sender, vTokenAddress, swapAmounts[1]);
        }
    }

    /**
     * @notice Swap token A for token B and repays a borrow from a Venus Market
     * @param vTokenAddress The address of the vToken contract to repay from.
     * @param amountIn The amount of tokens to swap.
     * @param amountOutMin Minimum amount of tokens to receive.
     * @param path Array with addresses of the underlying assets to be swapped
     * @dev Addresses of underlying assets should be ordered that first asset is the token we are swapping and second asset is the token we receive
     */
    function swapAndRepay(
        address vTokenAddress,
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external override ensure(deadline) {
        uint256[] memory swapAmounts = _swapExactTokensForTokens(amountIn, amountOutMin, path, msg.sender);
        TransferHelper.safeApprove(path[1], vTokenAddress, 0);
        TransferHelper.safeApprove(path[1], vTokenAddress, swapAmounts[1]);
        uint256 response = IVToken(vTokenAddress).repayBorrowBehalf(msg.sender, swapAmounts[1]);
        if (response != 0) {
            revert RepayError(msg.sender, vTokenAddress, response);
        } else {
            emit RepayOnBehalf(msg.sender, vTokenAddress, swapAmounts[1]);
        }
    }

    /**
     * @notice Swap BNB for another token and repays a borrow from a Venus Market
     * @dev The amount to be swapped is obtained from the msg.value, since we are swapping BNB
     * @param vTokenAddress The address of the vToken contract to repay from.
     * @param amountOutMin Minimum amount of tokens to receive.
     * @param path Array with addresses of the underlying assets to be swapped
     * @dev Addresses of underlying assets should be ordered that first asset is the token we are swapping and second asset is the token we receive
     */
    function swapBnbAndRepay(
        address vTokenAddress,
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external payable override ensure(deadline) {
        uint256[] memory swapAmounts = _swapExactETHForTokens(amountOutMin, path, msg.sender);
        TransferHelper.safeApprove(path[1], vTokenAddress, 0);
        TransferHelper.safeApprove(path[1], vTokenAddress, swapAmounts[1]);
        uint256 response = IVToken(vTokenAddress).repayBorrowBehalf(msg.sender, swapAmounts[1]);
        if (response != 0) {
            revert RepayError(msg.sender, vTokenAddress, response);
        } else {
            emit RepayOnBehalf(msg.sender, vTokenAddress, swapAmounts[1]);
        }
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external virtual override ensure(deadline) returns (uint256[] memory amounts) {
        amounts = _swapExactTokensForTokens(amountIn, amountOutMin, path, to);
    }

    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable virtual override ensure(deadline) returns (uint256[] memory amounts) {
        amounts = _swapExactETHForTokens(amountOutMin, path, to);
    }

    // **** LIBRARY FUNCTIONS ****
    function quote(
        uint256 amountA,
        uint256 reserveA,
        uint256 reserveB
    ) public pure virtual override returns (uint256 amountB) {
        return PancakeLibrary.quote(amountA, reserveA, reserveB);
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure virtual override returns (uint256 amountOut) {
        return PancakeLibrary.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure virtual override returns (uint256 amountIn) {
        return PancakeLibrary.getAmountIn(amountOut, reserveIn, reserveOut);
    }

    function getAmountsOut(uint256 amountIn, address[] memory path)
        public
        view
        virtual
        override
        returns (uint256[] memory amounts)
    {
        return PancakeLibrary.getAmountsOut(factory, amountIn, path);
    }

    function getAmountsIn(uint256 amountOut, address[] memory path)
        public
        view
        virtual
        override
        returns (uint256[] memory amounts)
    {
        return PancakeLibrary.getAmountsIn(factory, amountOut, path);
    }

    // ****************************
    // **** INTERNAL FUNCTIONS ****
    // ****************************

    // requires the initial amount to have already been sent to the first pair
    function _swap(
        uint256[] memory amounts,
        address[] memory path,
        address _to
    ) internal virtual {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0, ) = PancakeLibrary.sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = input == token0
                ? (uint256(0), amountOut)
                : (amountOut, uint256(0));
            address to = i < path.length - 2 ? PancakeLibrary.pairFor(factory, output, path[i + 2]) : _to;
            IPancakePair(PancakeLibrary.pairFor(factory, input, output)).swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }

    function _swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to
    ) internal returns (uint256[] memory amounts) {
        amounts = PancakeLibrary.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "PancakeRouter: INSUFFICIENT_OUTPUT_AMOUNT");
        TransferHelper.safeTransferFrom(
            path[0],
            msg.sender,
            PancakeLibrary.pairFor(factory, path[0], path[1]),
            amounts[0]
        );
        _swap(amounts, path, to);
    }

    function _swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to
    ) internal returns (uint256[] memory amounts) {
        address wBNBAddress = WBNB;
        if (path[0] != wBNBAddress) {
            revert WrongAddress(wBNBAddress, path[0]);
        }
        amounts = PancakeLibrary.getAmountsOut(factory, msg.value, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "PancakeRouter: INSUFFICIENT_OUTPUT_AMOUNT");
        IWBNB(wBNBAddress).deposit{ value: amounts[0] }();
        assert(IWBNB(wBNBAddress).transfer(PancakeLibrary.pairFor(factory, path[0], path[1]), amounts[0]));
        _swap(amounts, path, to);
    }
}