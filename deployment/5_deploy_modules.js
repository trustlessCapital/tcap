const GuardianStorage = require('../build/GuardianStorage');
const TransferStorage = require('../build/TransferStorage');

const GuardianHandler = require('../build/GuardianHandler');
const TokenSwapHandler = require('../build/TokenSwapHandler');
const LockHandler = require('../build/LockHandler');
const RecoveryHandler = require('../build/RecoveryHandler');
const ApprovedTransfer = require('../build/ApprovedTransfer');
const TransferHandler = require('../build/TransferHandler');

const DeployManager = require('../utils/deploy-manager.js');

/////////////////////////////////////////////////////////
//                 Version 1.1
/////////////////////////////////////////////////////////

const deploy = async (network, secret) => {

    ////////////////////////////////////
    // Setup
    ////////////////////////////////////

    const manager = new DeployManager(network);
    await manager.setup();

    const configurator = manager.configurator;
    const deployer = manager.deployer;
    const abiUploader = manager.abiUploader;

    const config = configurator.config;
    console.log(config);

    ////////////////////////////////////
    // Deploy Storage
    ////////////////////////////////////

    // Deploy the Guardian Storage
    const GuardianStorageWrapper = await deployer.deploy(GuardianStorage);
    // Deploy the Transfer Storage
    const TransferStorageWrapper = await deployer.deploy(TransferStorage);

    ////////////////////////////////////
    // Deploy Modules
    ////////////////////////////////////

    // Deploy the GuardianHandler module
    const GuardianHandlerWrapper = await deployer.deploy(
        GuardianHandler,
        {},
        config.contracts.ModuleRegistry,
        GuardianStorageWrapper.contractAddress,
        config.settings.securityPeriod || 0,
        config.settings.securityWindow || 0);
    // Deploy the LockHandler module
    const LockHandlerWrapper = await deployer.deploy(
        LockHandler,
        {},
        config.contracts.ModuleRegistry,
        GuardianStorageWrapper.contractAddress,
        config.settings.lockPeriod || 0);
    // Deploy the RecoveryHandler module
    const RecoveryHandlerWrapper = await deployer.deploy(
        RecoveryHandler,
        {},
        config.contracts.ModuleRegistry,
        GuardianStorageWrapper.contractAddress,
        config.settings.recoveryPeriod || 0,
        config.settings.lockPeriod || 0,
        config.settings.securityPeriod || 0,
        config.settings.securityWindow || 0);
    // Deploy the ApprovedTransfer module
    const ApprovedTransferWrapper = await deployer.deploy(
        ApprovedTransfer,
        {},
        config.contracts.ModuleRegistry,
        GuardianStorageWrapper.contractAddress);

    // Deploy the TransferHandler module
    const TransferHandlerWrapper = await deployer.deploy(
        TransferHandler,
        {},
        config.contracts.ModuleRegistry,
        config.modules.TransferStorage,
        config.modules.GuardianStorage,
        config.contracts.TokenPriceProvider,
        config.settings.securityPeriod || 0,
        config.settings.securityWindow || 0,
        config.settings.defaultLimit || '1000000000000000000'
    );
    // Deploy the TokenSwapHandler module
    const TokenSwapHandlerWrapper = await deployer.deploy(
        TokenSwapHandler,
        {},
        config.contracts.ModuleRegistry,
        GuardianStorageWrapper.contractAddress,
        config.Kyber.contract,
        config.contracts.MultiSigWallet,
        config.settings.feeRatio || 0);
    
    ///////////////////////////////////////////////////
    // Update config and Upload ABIs
    ///////////////////////////////////////////////////

    configurator.updateModuleAddresses({
        GuardianStorage: GuardianStorageWrapper.contractAddress,
        TransferStorage: TransferStorageWrapper.contractAddress,
        GuardianHandler: GuardianHandlerWrapper.contractAddress,
        LockHandler: LockHandlerWrapper.contractAddress,
        RecoveryHandler: RecoveryHandlerWrapper.contractAddress,
        ApprovedTransfer: ApprovedTransferWrapper.contractAddress,
        TransferHandler: TransferHandlerWrapper.contractAddress,
        TokenSwapHandler: TokenSwapHandlerWrapper.contractAddress
    });

    const gitHash = require('child_process').execSync('git rev-parse HEAD').toString('utf8').replace(/\n$/, '');
    configurator.updateGitHash(gitHash);

    await configurator.save();

    await Promise.all([
        abiUploader.upload(GuardianStorageWrapper, "modules"),
        abiUploader.upload(TransferStorageWrapper, "modules"),
        abiUploader.upload(GuardianHandlerWrapper, "modules"),
        abiUploader.upload(LockHandlerWrapper, "modules"),
        abiUploader.upload(RecoveryHandlerWrapper, "modules"),
        abiUploader.upload(ApprovedTransferWrapper, "modules"),
        abiUploader.upload(TransferHandlerWrapper, "modules"),
        abiUploader.upload(TokenSwapHandlerWrapper, "modules")
    ]);

    console.log('Config:', config);
};

module.exports = {
    deploy
};