const ModuleRegistry = require('../build/ModuleRegistry');
const MultiSig = require('../build/MultiSigWallet');

const GuardianHandler = require('../build/GuardianHandler');
const TokenSwapHandler = require('../build/TokenSwapHandler');
const LockHandler = require('../build/LockHandler');
const RecoveryHandler = require('../build/RecoveryHandler');
const ApprovedTransfer = require('../build/ApprovedTransfer');
const TransferHandler = require('../build/TransferHandler');

const utils = require('../utils/utilities.js');

const DeployManager = require('../utils/deploy-manager.js');
const MultisigExecutor = require('../utils/multisigexecutor.js');

const deploy = async (network, secret) => {

    ////////////////////////////////////
    // Setup
    ////////////////////////////////////

    const manager = new DeployManager(network);
    await manager.setup();

    const configurator = manager.configurator;
    const deployer = manager.deployer;
    const versionUploader = manager.versionUploader;

    const deploymentWallet = deployer.signer;

    const config = configurator.config;
    console.log('Config:', config);

    const GuardianHandlerWrapper = await deployer.wrapDeployedContract(GuardianHandler, config.modules.GuardianHandler);
    const LockHandlerWrapper = await deployer.wrapDeployedContract(LockHandler, config.modules.LockHandler);
    const RecoveryHandlerWrapper = await deployer.wrapDeployedContract(RecoveryHandler, config.modules.RecoveryHandler);
    const ApprovedTransferWrapper = await deployer.wrapDeployedContract(ApprovedTransfer, config.modules.ApprovedTransfer);
    const TransferHandlerWrapper = await deployer.wrapDeployedContract(TransferHandler, config.modules.TransferHandler);
    const TokenSwapHandlerWrapper = await deployer.wrapDeployedContract(TokenSwapHandler, config.modules.TokenSwapHandler);

    const ModuleRegistryWrapper = await deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
    const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);

    const wrappers = [
        GuardianHandlerWrapper,
        LockHandlerWrapper,
        RecoveryHandlerWrapper,
        ApprovedTransferWrapper,
        TransferHandlerWrapper,
        TokenSwapHandlerWrapper
    ];

    ////////////////////////////////////
    // Register modules
    ////////////////////////////////////

    const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign);

    for (let idx = 0; idx < wrappers.length; idx++) {
        let wrapper = wrappers[idx];
        await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule", [wrapper.contractAddress, utils.asciiToBytes32(wrapper._contract.contractName)]);
    }

    ////////////////////////////////////
    // Upload Version
    ////////////////////////////////////

    const modules = wrappers.map((wrapper) => {
        return { address: wrapper.contractAddress, name: wrapper._contract.contractName };
    });
    const version = {
        modules: modules,
        fingerprint: utils.versionFingerprint(modules),
        version: "1.0.0",
        createdAt: Math.floor((new Date()).getTime() / 1000)
    }
    await versionUploader.upload(version);
};

module.exports = {
    deploy
};