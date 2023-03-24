pragma solidity 0.8.13;

contract PrimeStorageV1 {
    struct Token {
        bool exists;
        bool isIrrevocable;
    }

    struct Market {
        uint256 supplyMultiplier;
        uint256 borrowMultiplier;
        uint256 rewardIndex;
        uint256 lastUpdated;
        uint256 score;
        uint256 timesScoreUpdated;
    }

    struct Interest {
        uint256 accrued;
        uint256 score;
        uint256 timesScoreUpdated;
        uint256 rewardIndex;
        uint256 supply;
        uint256 borrow;
    }

    /// @notice minimum amount of XVS user needs to stake to become a prime member
    uint256 public constant MINIMUM_STAKED_XVS = 1000 * 1e18;

    /// @notice maximum XVS taken in account when calculating user score
    uint256 public constant MAXIMUM_XVS_CAP = 10000 * 1e18;

    /// @notice number of days user need to stake to claim prime token
    uint256 internal constant STAKING_PERIOD = 90 * 24 * 60 * 60;

    /// @notice initial market index
    uint256 internal constant INITIAL_INDEX = 1e18;

    /// @notice maxmimum BPS = 100%
    uint256 internal constant MAXIMUM_BPS = 10000;

    /// @notice protocol income distribution BPS = 20%
    uint256 internal constant INCOME_DISTRIBUTION_BPS = 2000;

    /// @notice Mapping to get prime token's metadata
    mapping(address => Token) public tokens;

    /// @notice  Tracks total irrevocable tokens minted
    uint256 public _totalIrrevocable;

    /// @notice  Tracks total revocable tokens minted
    uint256 public _totalRevocable;

    /// @notice  Indicates maximum revocable tokens that can be minted
    uint256 public _revocableLimit;

    /// @notice  Indicates maximum irrevocable tokens that can be minted
    uint256 public _irrevocableLimit;

    /// @notice Tracks when prime token eligible users started staking for claiming prime token
    mapping(address => uint256) public stakedAt;

    /// @notice vToken to market configuration
    mapping(address => Market) public markets;

    /// @notice vToken to user to user index
    mapping(address => mapping(address => Interest)) public interests;

    /// @notice A list of boosted markets
    address[] public allMarkets;

    /// @notice numberator of alpha. Ex: if alpha is 0.5 then this will be 1
    uint128 public alphaNumerator;

    /// @notice denominator of alpha. Ex: if alpha is 0.5 then this will be 2
    uint128 public alphaDenominator;

    /// @notice address of XVS vault
    address internal xvsVault;

    address internal xvsVaultRewardToken;

    uint256 internal xvsVaultPoolId;
}
