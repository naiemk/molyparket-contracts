# Ignition Deployment Modules with CREATE2 Policy

This directory contains Hardhat Ignition deployment modules for the Molyparket prediction market contracts using CREATE2 policy for deterministic deployments. Ignition automatically handles CreateX in the background.

## Available Modules

### 1. `BetResolver.js`
Deploys the BetResolver contract with CREATE2 policy.

### 2. `BetMarket.js` 
Deploys the BetMarket contract with dependencies on BetResolver using CREATE2 policy.

### 3. `BetResolverConfig.js`
Configures the BetResolver contract after both contracts are deployed.

### 4. `FullDeployment.js` (Recommended)
Complete deployment module that handles all steps in the correct order:
1. Deploy BetResolver with CREATE2 policy
2. Deploy BetMarket with BetResolver address using CREATE2 policy
3. Configure BetResolver with BetMarket address and parameters
4. Set fees for BetResolver

## Usage

### Deploy with Default Parameters
```bash
npx hardhat ignition deploy ignition/modules/FullDeployment.js
```

### Deploy with Custom Parameters
```bash
npx hardhat ignition deploy ignition/modules/FullDeployment.js \
  --parameters betResolverSalt=0xabcd... \
  --parameters betMarketSalt=0xefgh... \
  --parameters collateralToken=0x5678... \
  --parameters dtnAi=0x9abc... \
  --parameters reserveAddress=0xdef0... \
  --parameters systemPrompt="Custom system prompt" \
  --parameters modelName="model.system.openai-gpt-o4" \
  --parameters nodeName="node.production.node1"
```

## Required Parameters

### CREATE2 Salt Configuration
- `betResolverSalt`: Salt for CREATE2 deployment of BetResolver
- `betMarketSalt`: Salt for CREATE2 deployment of BetMarket

### For BetMarket
- `collateralToken`: Address of the ERC20 token used as collateral (e.g., USDC)
- `reserveAddress`: Address that receives protocol fees

### For BetResolver Configuration
- `dtnAi`: Address of the DtnAI contract
- `systemPrompt`: System prompt for the AI oracle
- `modelName`: Name of the AI model to use
- `nodeName`: Name of the DtnAI node to use

## Optional Parameters

### Fee Configuration (BetResolver)
- `feePerByteReq`: Fee per byte for requests (default: 0.001 * 1e18)
- `feePerByteRes`: Fee per byte for responses (default: 0.001 * 1e18)
- `totalFeePerRes`: Total fee per resolution (default: 1 * 1e18)
- `resolutionGasLimit`: Gas limit for resolution calls (default: 400000)

## Deployment Order

The contracts must be deployed in this order due to dependencies:
1. **BetResolver** - Deployed with CREATE2 policy (Ignition handles CreateX automatically)
2. **BetMarket** - Deployed with CREATE2 policy, requires BetResolver address
3. **Configuration** - BetResolver needs BetMarket address

## Example Deployment Script

```javascript
// Example deployment with custom parameters
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("Deploying contracts with account:", deployer.address);
  
  // Deploy using Ignition
  await hre.ignition.deploy("FullDeploymentModule", {
    parameters: {
      betResolverSalt: "0x0000000000000000000000000000000000000000000000000000000000000001",
      betMarketSalt: "0x0000000000000000000000000000000000000000000000000000000000000002",
      collateralToken: "0xA0b86a33E6441b8c4C8C0C8C0C8C0C8C0C8C0C8C", // USDC
      dtnAi: "0x1234567890123456789012345678901234567890", // DtnAI address
      reserveAddress: "0x0000000000000000000000000000000000000000", // Reserve
      systemPrompt: "You are a prediction market oracle. Respond with exactly 'true', 'false', or 'inconclusive' based on the given question.",
      modelName: "model.system.openai-gpt-o3-simpletext",
      nodeName: "node.tester.node1"
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

## Post-Deployment Steps

After deployment, you may need to:

1. **Fund the BetResolver** with fee tokens for DtnAI operations
2. **Start a DtnAI session** by calling `restartSession()` on BetResolver
3. **Verify contracts** on block explorers
4. **Set up monitoring** for events and contract interactions

## Network-Specific Deployments

For different networks, you can specify the network in your hardhat config and deploy:

```bash
# Deploy to testnet
npx hardhat ignition deploy ignition/modules/FullDeployment.js --network sepolia

# Deploy to mainnet
npx hardhat ignition deploy ignition/modules/FullDeployment.js --network mainnet
```

Make sure to update the parameter values appropriately for each network (e.g., correct USDC addresses, DtnAI addresses, etc.).

## CREATE2 Benefits

Using CREATE2 policy provides:

1. **Deterministic Addresses** - Same contract gets same address across networks
2. **Gas Efficiency** - Optimized deployment patterns through CreateX
3. **Verification** - Easy contract verification on block explorers
4. **Upgradeability** - Foundation for upgradeable contracts
5. **Cross-Chain Consistency** - Same addresses across different networks

## Note on CreateX

CreateX is automatically handled by Ignition when using the CREATE2 policy. You don't need to:
- Deploy CreateX manually
- Specify CreateX factory addresses
- Handle CreateX interactions directly

Ignition manages all CreateX operations behind the scenes for optimal deployment patterns. 