pragma solidity ^0.5.7;

import "../../lib/utils/SafeMath.sol";
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/MetaTxHandler.sol";
import "./common/OnlyOwnerModule.sol";
import "../defi/compound/CompoundRegistry.sol";

interface IComptroller {
    function enterMarkets(address[] calldata _cTokens) external returns (uint[] memory);
    function exitMarket(address _cToken) external returns (uint);
    function getAssetsIn(address _account) external view returns (address[] memory);
    function getAccountLiquidity(address _account) external view returns (uint, uint, uint);
    function checkMembership(address account, ICToken cToken) external view returns (bool);
}

interface ICToken {
    function comptroller() external view returns (address);
    function underlying() external view returns (address);
    function symbol() external view returns (string memory);
    function exchangeRateCurrent() external returns (uint256);
    function exchangeRateStored() external view returns (uint256);
    function balanceOf(address _account) external view returns (uint256);
    function borrowBalanceCurrent(address _account) external returns (uint256);
    function borrowBalanceStored(address _account) external view returns (uint256);
}

/**
 * @title CompoundHandler
 * @dev Module to invest and borrow tokens with Compound
 */
contract CompoundHandler is BaseModule, MetaTxHandler, OnlyOwnerModule {

    bytes32 constant NAME = "CompoundHandler";

    // The Compound IComptroller contract
    IComptroller public comptroller;
    // The registry mapping underlying with cTokens
    CompoundRegistry public compoundRegistry;

    // Mock token address for ETH
    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    using SafeMath for uint256;

    event InvestmentAdded(address indexed _wallet, address _token, uint256 _invested, uint256 _period);
    event InvestmentRemoved(address indexed _wallet, address _token, uint256 _fraction);

    constructor(
        ModuleRegistry _registry,
        GuardianStorage _guardianStorage,
        IComptroller _comptroller,
        CompoundRegistry _compoundRegistry
    )
        BaseModule(_registry, _guardianStorage, NAME)
        public
    {
        comptroller = _comptroller;
        compoundRegistry = _compoundRegistry;
    }

    /**
     * @dev Invest tokens for a given period.
     * @param _wallet The target wallet.
     * @param _token The token address.
     * @param _amount The amount of tokens to invest.
     * @param _period The period over which the tokens may be locked in the investment (optional).
     * @return The exact amount of tokens that have been invested.
     */
    function addInvestment(
        BaseWallet _wallet,
        address _token,
        uint256 _amount,
        uint256 _period
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
        returns (uint256 _invested)
    {
        address cToken = compoundRegistry.getCToken(_token);
        mint(_wallet, cToken, _token, _amount);
        _invested = _amount;
        emit InvestmentAdded(address(_wallet), _token, _amount, _period);
    }

    /**
     * @dev Exit invested postions.
     * @param _wallet The target wallet.
     * @param _token The token address.
     * @param _fraction The fraction of invested tokens to exit in per 10000.
     */
    function removeInvestment(
        BaseWallet _wallet,
        address _token,
        uint256 _fraction
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
    {
        require(_fraction <= 10000, "CompoundV2: invalid fraction value");
        address cToken = compoundRegistry.getCToken(_token);
        uint shares = ICToken(cToken).balanceOf(address(_wallet));
        redeem(_wallet, cToken, shares.mul(_fraction).div(10000));
        emit InvestmentRemoved(address(_wallet), _token, _fraction);
    }

    /**
     * @dev Get the amount of investment in a given token.
     * @param _wallet The target wallet.
     * @param _token The token address.
     * @return The value in tokens of the investment (including interests) and the time at which the investment can be removed.
     */
    function getInvestment(
        BaseWallet _wallet,
        address _token
    )
        external
        view
        returns (uint256 _tokenValue, uint256 _periodEnd)
    {
        address cToken = compoundRegistry.getCToken(_token);
        uint amount = ICToken(cToken).balanceOf(address(_wallet));
        uint exchangeRateMantissa = ICToken(cToken).exchangeRateStored();
        _tokenValue = amount.mul(exchangeRateMantissa).div(10 ** 18);
        _periodEnd = 0;
    }

    /* ****************************************** Compound wrappers ******************************************* */

    /**
     * @dev Adds underlying tokens to a cToken contract.
     * @param _wallet The target wallet.
     * @param _cToken The cToken contract.
     * @param _token The underlying token.
     * @param _amount The amount of underlying token to add.
     */
    function mint(BaseWallet _wallet, address _cToken, address _token, uint256 _amount) internal {
        require(_cToken != address(0), "Compound: No market for target token");
        require(_amount > 0, "Compound: amount cannot be 0");
        if (_token == ETH_TOKEN_ADDRESS) {
            invokeWallet(address(_wallet), _cToken, _amount, abi.encodeWithSignature("mint()"));
        } else {
            invokeWallet(address(_wallet), _token, 0, abi.encodeWithSignature("approve(address,uint256)", _cToken, _amount));
            invokeWallet(address(_wallet), _cToken, 0, abi.encodeWithSignature("mint(uint256)", _amount));
        }
    }

    /**
     * @dev Redeems underlying tokens from a cToken contract.
     * @param _wallet The target wallet.
     * @param _cToken The cToken contract.
     * @param _amount The amount of cToken to redeem.
     */
    function redeem(BaseWallet _wallet, address _cToken, uint256 _amount) internal {
        require(_cToken != address(0), "Compound: No market for target token");
        require(_amount > 0, "Compound: amount cannot be 0");
        invokeWallet(address(_wallet), _cToken, 0, abi.encodeWithSignature("redeem(uint256)", _amount));
    }

    /**
     * @dev Redeems underlying tokens from a cToken contract.
     * @param _wallet The target wallet.
     * @param _cToken The cToken contract.
     * @param _amount The amount of underlying token to redeem.
     */
    function redeemUnderlying(BaseWallet _wallet, address _cToken, uint256 _amount) internal {
        require(_cToken != address(0), "Compound: No market for target token");
        require(_amount > 0, "Compound: amount cannot be 0");
        invokeWallet(address(_wallet), _cToken, 0, abi.encodeWithSignature("redeemUnderlying(uint256)", _amount));
    }

    /**
     * @dev Borrows underlying tokens from a cToken contract.
     * @param _wallet The target wallet.
     * @param _cToken The cToken contract.
     * @param _amount The amount of underlying tokens to borrow.
     */
    function borrow(BaseWallet _wallet, address _cToken, uint256 _amount) internal {
        require(_cToken != address(0), "Compound: No market for target token");
        require(_amount > 0, "Compound: amount cannot be 0");
        invokeWallet(address(_wallet), _cToken, 0, abi.encodeWithSignature("borrow(uint256)", _amount));
    }

    /**
     * @dev Repays some borrowed underlying tokens to a cToken contract.
     * @param _wallet The target wallet.
     * @param _cToken The cToken contract.
     * @param _amount The amount of underlying to repay.
     */
    function repayBorrow(BaseWallet _wallet, address _cToken, uint256 _amount) internal {
        require(_cToken != address(0), "Compound: No market for target token");
        require(_amount > 0, "Compound: amount cannot be 0");
        string memory symbol = ICToken(_cToken).symbol();
        if (keccak256(abi.encodePacked(symbol)) == keccak256(abi.encodePacked("cETH"))) {
            invokeWallet(address(_wallet), _cToken, _amount, abi.encodeWithSignature("repayBorrow()"));
        } else {
            address token = ICToken(_cToken).underlying();
            invokeWallet(address(_wallet), token, 0, abi.encodeWithSignature("approve(address,uint256)", _cToken, _amount));
            invokeWallet(address(_wallet), _cToken, 0, abi.encodeWithSignature("repayBorrow(uint256)", _amount));
        }
    }

    /**
     * @dev Enters a cToken market if it was not entered before.
     * @param _wallet The target wallet.
     * @param _cToken The cToken contract.
     * @param _comptroller The comptroller contract.
     */
    function enterMarketIfNeeded(BaseWallet _wallet, address _cToken, address _comptroller) internal {
        bool isEntered = IComptroller(_comptroller).checkMembership(address(_wallet), ICToken(_cToken));
        if (!isEntered) {
            address[] memory market = new address[](1);
            market[0] = _cToken;
            invokeWallet(address(_wallet), _comptroller, 0, abi.encodeWithSignature("enterMarkets(address[])", market));
        }
    }

    /**
     * @dev Exits a cToken market if there is no more collateral and debt.
     * @param _wallet The target wallet.
     * @param _cToken The cToken contract.
     * @param _comptroller The comptroller contract.
     */
    function exitMarketIfNeeded(BaseWallet _wallet, address _cToken, address _comptroller) internal {
        uint collateral = ICToken(_cToken).balanceOf(address(_wallet));
        uint debt = ICToken(_cToken).borrowBalanceStored(address(_wallet));
        if (collateral == 0 && debt == 0) {
            invokeWallet(address(_wallet), _comptroller, 0, abi.encodeWithSignature("exitMarket(address)", _cToken));
        }
    }
}
