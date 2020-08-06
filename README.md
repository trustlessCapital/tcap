[![Gitter](https://badges.gitter.im/tcap-xyz/community.svg)](https://gitter.im/tcap-xyz/community?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge)
# Trustless capital smart contracts

[Trustless Capital Protocol](https://trustless.capital/) implemented an intutive solution for the consumers and businesses to perform seamless global payments through ethereum based smart contracts.



## Quick Start the Development Locally

### Minimum requirements

Requirements|Detail
---|---
Node version | [v10.0.0 or higher](https://nodejs.org/en/)
LimeChain Etherlime | [Etherlime](https://github.com/LimeChain/etherlime)
Solc | [5.7](https://solidity.readthedocs.io/en/v0.5.7/installing-solidity.html)
Solium | [Solium](https://github.com/duaraghav8/Solium)
OpenZeppelin | [OpenZeppelin](https://github.com/OpenZeppelin/openzeppelin-solidity)


### Install

Install requirements with npm:
```
npm install
```

### Compile

Compile the external contracts:
```
npm run compile:lib
```

Compile the contracts:
```
npm run compile
```

### Test

Launch ganache:
```
npm run ganache
```

Run the tests:
```
npm run test
```

### License

Released under [GPL-3.0](LICENSE)
