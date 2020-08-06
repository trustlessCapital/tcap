pragma solidity ^0.5.7;
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/MetaTxHandler.sol";
import "./common/OnlyOwnerModule.sol";
import "../../lib/utils/SafeMath.sol";
import "../exchange/ERC20.sol";
import "../exchange/KyberNetwork.sol";

/**
 * @title TokenSwapHandler
 * @dev Module to trade tokens (ETH or ERC20) using KyberNetworks.
 */
contract TokenSwapHandler is BaseModule, MetaTxHandler, OnlyOwnerModule {

    bytes32 constant NAME = "TokenSwapHandler";

    using SafeMath for uint256;

    // Mock token address for ETH
    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // The address of the KyberNetwork proxy contract
    address public kyber;
    // The address of the contract collecting fees for Trustless Capital.
    address public feeCollector;
    // The Trustless Capital fee (125 basis points)
    uint256 public feeRatio;

    event TokenExchanged(address indexed wallet, address srcToken, uint srcAmount, address destToken, uint destAmount);

    constructor(
        ModuleRegistry _registry,
        GuardianStorage _guardianStorage,
        address _kyber,
        address _feeCollector,
        uint _feeRatio
    )
        BaseModule(_registry, _guardianStorage, NAME)
        public
    {
        kyber = _kyber;
        feeCollector = _feeCollector;
        feeRatio = _feeRatio;
    }

    /**
     * @dev Lets the owner of the wallet execute a trade.
     * @param _wallet The target wallet
     * @param _srcToken The address of the source token.
     * @param _srcAmount The amoutn of source token to trade.
     * @param _destToken The address of the destination token.
     * @param _maxDestAmount The maximum amount of destination token accepted for the trade.
     * @param _minConversionRate The minimum accepted rate for the trade.
     * @return The amount of destination tokens that have been received.
     */
    function trade(
        BaseWallet _wallet,
        address _srcToken,
        uint256 _srcAmount,
        address _destToken,
        uint256 _maxDestAmount,
        uint256 _minConversionRate
    )
        external
        onlyWalletOwner(_wallet)
        onlyWhenUnlocked(_wallet)
        returns(uint256)
    {
        bytes memory methodData;
        require(_srcToken == ETH_TOKEN_ADDRESS || _destToken == ETH_TOKEN_ADDRESS, "TE: source or destination must be ETH");
        (uint256 destAmount, uint256 fee, ) = getExpectedTrade(_srcToken, _destToken, _srcAmount);
        if (destAmount > _maxDestAmount) {
            fee = fee.mul(_maxDestAmount).div(destAmount);
            destAmount = _maxDestAmount;
        }
        if (_srcToken == ETH_TOKEN_ADDRESS) {
            uint256 srcTradable = _srcAmount.sub(fee);
            methodData = abi.encodeWithSignature(
                "trade(address,uint256,address,address,uint256,uint256,address)",
                _srcToken,
                srcTradable,
                _destToken,
                address(_wallet),
                _maxDestAmount,
                _minConversionRate,
                feeCollector
                );
            invokeWallet(address(_wallet), kyber, srcTradable, methodData);
        } else {
            // approve kyber on erc20
            methodData = abi.encodeWithSignature("approve(address,uint256)", kyber, _srcAmount);
            invokeWallet(address(_wallet), _srcToken, 0, methodData);
            // transfer erc20
            methodData = abi.encodeWithSignature(
                "trade(address,uint256,address,address,uint256,uint256,address)",
                _srcToken,
                _srcAmount,
                _destToken,
                address(_wallet),
                _maxDestAmount,
                _minConversionRate,
                feeCollector
                );
            invokeWallet(address(_wallet), kyber, 0, methodData);
        }

        if (fee > 0) {
            invokeWallet(address(_wallet), feeCollector, fee, "");
        }
        emit TokenExchanged(address(_wallet), _srcToken, _srcAmount, _destToken, destAmount);
        return destAmount;
    }

    /**
     * @dev Gets the expected terms of a trade.
     * @param _srcToken The address of the source token.
     * @param _destToken The address of the destination token.
     * @param _srcAmount The amount of source token to trade.
     * @return the amount of destination tokens to be received and the amount of ETH paid to Trustless Capital as fee.
     */
    function getExpectedTrade(
        address _srcToken,
        address _destToken,
        uint256 _srcAmount
    )
        public
        view
        returns(uint256 _destAmount, uint256 _fee, uint256 _expectedRate)
    {
        if (_srcToken == ETH_TOKEN_ADDRESS) {
            _fee = computeFee(_srcAmount);
            (_expectedRate,) = KyberNetwork(kyber).getExpectedRate(ERC20(_srcToken), ERC20(_destToken), _srcAmount.sub(_fee));
            uint256 destDecimals = ERC20(_destToken).decimals();
            // destAmount = expectedRate * (_srcAmount - fee) / ETH_PRECISION * (DEST_PRECISION / SRC_PRECISION)
            _destAmount = _expectedRate.mul(_srcAmount.sub(_fee)).div(10 ** (36-destDecimals));
        } else {
            (_expectedRate,) = KyberNetwork(kyber).getExpectedRate(ERC20(_srcToken), ERC20(_destToken), _srcAmount);
            uint256 srcDecimals = ERC20(_srcToken).decimals();
            // destAmount = expectedRate * _srcAmount / ETH_PRECISION * (DEST_PRECISION / SRC_PRECISION) - fee
            _destAmount = _expectedRate.mul(_srcAmount).div(10 ** srcDecimals);
            _fee = computeFee(_destAmount);
            _destAmount -= _fee;
        }
    }

    /**
     * @dev Computes the Trustless Capital fee based on the amount of source tokens in ETH.
     * @param _srcAmount The amount of source token to trade in ETH.
     * @return the fee paid to Trustless Capital.
     */
    function computeFee(uint256 _srcAmount) internal view returns (uint256 fee) {
        fee = (_srcAmount * feeRatio) / 10000;
    }
}