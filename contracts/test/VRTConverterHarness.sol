pragma solidity 0.8.13;

import "../../contracts/Tokens/VRT/VRTConverter.sol";

contract VRTConverterHarness is VRTConverter {
    using SafeMath for uint256;

    constructor() public VRTConverter() {
        admin = msg.sender;
    }

    function balanceOfUser() public view returns (uint256, address) {
        uint256 vrtBalanceOfUser = vrt.balanceOf(msg.sender);
        return (vrtBalanceOfUser, msg.sender);
    }

    function setConversionRatio(uint256 _conversionRatio) public onlyAdmin {
        conversionRatio = _conversionRatio;
    }

    function setConversionTimeline(uint256 _conversionStartTime, uint256 _conversionPeriod) public onlyAdmin {
        conversionStartTime = _conversionStartTime;
        conversionPeriod = _conversionPeriod;
        conversionEndTime = conversionStartTime.add(conversionPeriod);
    }

    function getXVSRedeemedAmount(uint256 vrtAmount) public view returns (uint256) {
        return vrtAmount.mul(conversionRatio).mul(xvsDecimalsMultiplier).div(1e18).div(vrtDecimalsMultiplier);
    }
}
