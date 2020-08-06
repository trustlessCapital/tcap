pragma solidity ^0.5.7;
import "../wallet/BaseWallet.sol";
import "./Storage.sol";

/**
 * @title TransferStorage
 * @dev Contract storing the state of wallets related to transfers (limit and whitelist).
 * Only modules authorised for a wallet can modify its state.
 */
contract TransferStorage is Storage {

    // wallet specific storage
    mapping (address => mapping (address => uint256)) internal whitelist;

    // *************** External Functions ********************* //

    /**
     * @dev Lets an authorised module add or remove an account from the whitelist of a wallet.
     * @param _wallet The target wallet.
     * @param _target The account to add/remove.
     * @param _value True for addition, false for revokation.
     */
    function setWhitelist(BaseWallet _wallet, address _target, uint256 _value) external onlyModule(_wallet) {
        whitelist[address(_wallet)][_target] = _value;
    }

    /**
     * @dev Gets the whitelist state of an account for a wallet.
     * @param _wallet The target wallet.
     * @param _target The account.
     * @return the epoch time at which an account strats to be whitelisted, or zero if the account is not whitelisted.
     */
    function getWhitelist(BaseWallet _wallet, address _target) external view returns (uint256) {
        return whitelist[address(_wallet)][_target];
    }
}