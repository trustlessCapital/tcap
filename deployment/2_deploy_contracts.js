const BaseWallet = require('../build/BaseWallet');
const ModuleRegistry = require('../build/ModuleRegistry');
const MultiSig = require('../build/MultiSigWallet');
const WalletFactory = require('../build/WalletFactory');
const TokenPriceProvider = require("../build/TokenPriceProvider");

const utils = require('../utils/utilities.js');

const DeployManager = require('../utils/deploy-manager.js');

const deploy = async (network, secret) => {

    ////////////////////////////////////
    // Setup
    ////////////////////////////////////

    const manager = new DeployManager(network);
    await manager.setup();

    const configurator = manager.configurator;
    const deployer = manager.deployer;
    const abiUploader = manager.abiUploader;

    const newConfig = configurator.config;
    const prevConfig = configurator.copyConfig();
    console.log('Previous Config:', prevConfig);


    ////////////////////////////////////
    // Deploy contracts
    ////////////////////////////////////

    // Deploy the Base Wallet Library
    const BaseWalletWrapper = await deployer.deploy(BaseWallet);
    // Deploy the MultiSig
    const MultiSigWrapper = await deployer.deploy(MultiSig, {}, newConfig.multisig.threshold, newConfig.multisig.owners);
    // Deploy TokenPriceProvider
    const TokenPriceProviderWrapper = await deployer.deploy(TokenPriceProvider, {}, newConfig.Kyber.contract);
    // Deploy Module Registry
    const ModuleRegistryWrapper = await deployer.deploy(ModuleRegistry);
    // Deploy the Wallet Factory
    const WalletFactoryWrapper = await deployer.deploy(WalletFactory, {}, ModuleRegistryWrapper.contractAddress, BaseWalletWrapper.contractAddress);

    ///////////////////////////////////////////////////
    // Update config and Upload ABIs
    ///////////////////////////////////////////////////

    configurator.updateInfrastructureAddresses({
        MultiSigWallet: MultiSigWrapper.contractAddress,
        WalletFactory: WalletFactoryWrapper.contractAddress,
        TokenPriceProvider: TokenPriceProviderWrapper.contractAddress,
        ModuleRegistry: ModuleRegistryWrapper.contractAddress,
        BaseWallet: BaseWalletWrapper.contractAddress
    });
    await configurator.save();

    await Promise.all([
        abiUploader.upload(MultiSigWrapper, "contracts"),
        abiUploader.upload(WalletFactoryWrapper, "contracts"),
        abiUploader.upload(TokenPriceProviderWrapper, "contracts"),
        abiUploader.upload(ModuleRegistryWrapper, "contracts"),
        abiUploader.upload(BaseWalletWrapper, "contracts")
    ]);
};

module.exports = {
    deploy
};