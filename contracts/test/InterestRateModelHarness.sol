pragma solidity 0.8.13;

import "../InterestRateModels/V0.8.13/InterestRateModel.sol";

/**
 * @title An Interest Rate Model for tests that can be instructed to return a failure instead of doing a calculation
 * @author Venus
 */
contract InterestRateModelHarness is InterestRateModel {
    uint public constant opaqueBorrowFailureCode = 20;
    bool public failBorrowRate;
    uint public borrowRate;

    constructor(uint borrowRate_) public {
        borrowRate = borrowRate_;
    }

    function setFailBorrowRate(bool failBorrowRate_) public {
        failBorrowRate = failBorrowRate_;
    }

    function setBorrowRate(uint borrowRate_) public {
        borrowRate = borrowRate_;
    }

    function getBorrowRate(uint _cash, uint _borrows, uint _reserves) public view override returns (uint) {
        _cash; // unused
        _borrows; // unused
        _reserves; // unused
        require(!failBorrowRate, "INTEREST_RATE_MODEL_ERROR");
        return borrowRate;
    }

    function getSupplyRate(
        uint _cash,
        uint _borrows,
        uint _reserves,
        uint _reserveFactor
    ) external view override returns (uint) {
        _cash; // unused
        _borrows; // unused
        _reserves; // unused
        return borrowRate * (1 - _reserveFactor);
    }

    function utilizationRate(uint cash, uint borrows, uint reserves) public pure returns (uint) {
        // Utilization rate is 0 when there are no borrows
        if (borrows == 0) {
            return 0;
        }

        return (borrows) / (cash + borrows - reserves);
    }
}
