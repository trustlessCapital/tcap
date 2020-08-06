pragma solidity ^0.5.7;
import "../wallet/BaseWallet.sol";
import "./common/BaseModule.sol";
import "./common/MetaTxHandler.sol";
import "../utils/GuardianUtils.sol";

/**
 * @title LockHandler
 * @dev Module to manage the state of a wallet's lock.
 * Other modules can use the state of the lock to determine if their operations
 * should be authorised or blocked. Only the guardians of a wallet can lock and unlock it.
 * The lock automatically unlocks after a given period. The lock state is stored on a saparate
 * contract to facilitate its use by other modules.
 */
contract LockHandler is BaseModule, MetaTxHandler {

    bytes32 constant NAME = "LockHandler";

    // The lock period
    uint256 public lockPeriod;

    // *************** Events *************************** //

    event Locked(address indexed wallet, uint64 releaseAfter);
    event Unlocked(address indexed wallet);

    // *************** Modifiers ************************ //

    /**
     * @dev Throws if the wallet is not locked.
     */
    modifier onlyWhenLocked(BaseWallet _wallet) {
        // solium-disable-next-line security/no-block-members
        require(guardianStorage.isLocked(_wallet), "GD: wallet must be locked");
        _;
    }

    /**
     * @dev Throws if the caller is not a guardian for the wallet.
     */
    modifier onlyGuardian(BaseWallet _wallet) {
        (bool isGuardian, ) = GuardianUtils.isGuardian(guardianStorage.getGuardians(_wallet), msg.sender);
        require(msg.sender == address(this) || isGuardian, "GD: wallet must be unlocked");
        _;
    }

    // *************** Constructor ************************ //

    constructor(
        ModuleRegistry _registry,
        GuardianStorage _guardianStorage,
        uint256 _lockPeriod
    )
        BaseModule(_registry, _guardianStorage, NAME) public {
        lockPeriod = _lockPeriod;
    }

    // *************** External functions ************************ //

    /**
     * @dev Lets a guardian lock a wallet.
     * @param _wallet The target wallet.
     */
    function lock(BaseWallet _wallet) external onlyGuardian(_wallet) onlyWhenUnlocked(_wallet) {
        guardianStorage.setLock(_wallet, now + lockPeriod);
        emit Locked(address(_wallet), uint64(now + lockPeriod));
    }

    /**
     * @dev Lets a guardian unlock a locked wallet.
     * @param _wallet The target wallet.
     */
    function unlock(BaseWallet _wallet) external onlyGuardian(_wallet) onlyWhenLocked(_wallet) {
        address locker = guardianStorage.getLocker(_wallet);
        require(locker == address(this), "LM: cannot unlock a wallet that was locked by another module");
        guardianStorage.setLock(_wallet, 0);
        emit Unlocked(address(_wallet));
    }

    /**
     * @dev Returns the release time of a wallet lock or 0 if the wallet is unlocked.
     * @param _wallet The target wallet.
     * @return The epoch time at which the lock will release (in seconds).
     */
    function getLock(BaseWallet _wallet) public view returns(uint64 _releaseAfter) {
        uint256 lockEnd = guardianStorage.getLock(_wallet);
        if (lockEnd > now) {
            _releaseAfter = uint64(lockEnd);
        }
    }

    /**
     * @dev Checks if a wallet is locked.
     * @param _wallet The target wallet.
     * @return true if the wallet is locked.
     */
    function isLocked(BaseWallet _wallet) external view returns (bool _isLocked) {
        return guardianStorage.isLocked(_wallet);
    }

    // *************** Implementation of MetaTxHandler methods ********************* //

    // Overrides to use the incremental nonce and save some gas
    function checkAndUpdateUniqueness(BaseWallet _wallet, uint256 _nonce, bytes32 /* _signHash */) internal returns (bool) {
        return checkAndUpdateNonce(_wallet, _nonce);
    }

    function validateSignatures(
        BaseWallet _wallet,
        bytes memory /* _data */,
        bytes32 _signHash,
        bytes memory _signatures
    )
        internal
        view
        returns (bool)
    {
        (bool isGuardian, ) = GuardianUtils.isGuardian(guardianStorage.getGuardians(_wallet), recoverSigner(_signHash, _signatures, 0));
        return isGuardian; // "LM: must be a guardian to lock or unlock"
    }

    function getRequiredSignatures(BaseWallet /* _wallet */, bytes memory /* _data */) internal view returns (uint256) {
        return 1;
    }
}