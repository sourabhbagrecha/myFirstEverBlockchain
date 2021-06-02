const SHA256 = require('sha256');
const currentNodeUrl = process.argv[3];
const uuid = require('uuid').v1;


class Blockchain {
    constructor() {
        this.chain = [];
        this.pendingTransactions = [];
    
        this.currentNodeUrl = currentNodeUrl;
        this.networkNodes = [];
        this.createNewBlock(100, '0', '0');
    }

    createNewBlock (nonce, previousBlockHash, hash){
        const newBlock = {
            index: this.chain.length + 1,
            timestamp: Date.now(),
            transactions: this.pendingTransactions, 
            nonce: nonce,
            hash: hash,
            previousBlockHash: previousBlockHash
        };
    
        this.pendingTransactions = [];
        this.chain.push(newBlock);
    
        return newBlock;
    }

    getLastBlock(){
        return this.chain[this.chain.length-1];
    }
    
    createNewTransaction(amount, sender, recipient){
        const transactionId = uuid().split('-').join('');
        const newTransaction = {
            amount: amount,
            sender: sender,
            recipient: recipient,
            transactionId,
        }
        return newTransaction;
    }
    
    addTransactionToPendingTransactions(transactionObj){
        this.pendingTransactions.push(transactionObj);
        return this.getLastBlock()['index'] + 1;
    }
    
    hashBlock(previousBlockHash, currentBlockData, nonce){
        const dataAsString = previousBlockHash + nonce.toString() + JSON.stringify(currentBlockData);
        const hash = SHA256(dataAsString);
        return hash; 
    }
    
    proofOfWork(previousBlockHash, currentBlockData){
        let nonce = 0;
        let hash = this.hashBlock(previousBlockHash, currentBlockData, nonce);
        while(hash.substring(0,4) !== '0000'){
            nonce++;
            hash = this.hashBlock(previousBlockHash, currentBlockData, nonce)
        }
        return nonce;
    }
    
    chainIsValid(blockchain) {
        for(let i=1; i<blockchain.length; i++){
            const currentBlock = blockchain[i];
            const previousBlock = blockchain[i-1];
            if(currentBlock.previousBlockHash !== previousBlock.hash) return false;
            const currentBlockData = {
                transactions: currentBlock.transactions,
                index: currentBlock.index
            }
            const blockHash = this.hashBlock(previousBlock.hash, currentBlockData, currentBlock.nonce);
            if(blockHash.substring(0, 4) !== '0000') return false;
        };
        const genesisBlock = blockchain.chain[0];
        const correctNonce = genesisBlock['nonce'] === 100;
        const correctPreviousBlockHash = genesisBlock['previousBlockHash'] === '0';
        const correctHash = genesisBlock['hash'] === '0';
        const correctTransactions = genesisBlock['transactions'].length === 0;
        if(!correctNonce || !correctPreviousBlockHash || !correctHash || !correctTransactions){
            return false;
        }
        return true;
    }
    
    getBlock(blockHash){
        const block = this.chain.find((v, i) => v.hash === blockHash);
        return block;
    }
    
    getTransaction(transactionId){
        let transaction, blockFound;
        this.chain.forEach(block => {
            transaction = block.transactions.find((v, i) => v['transactionId'] === transactionId);
            if(transaction) blockFound = block;
        });
        return {transaction: transaction, blockFound};
    }
    
    getAddressData(address){
        const trans = [];
        let balance = 0;
        this.chain.forEach(block => {
            block.transactions.forEach( transaction => {
                if(transaction.sender === address || transaction.recipient === address){
                    trans.push(transaction)
                }
            })
        });
        trans.forEach(t => {
            if(t.recipient === address) balance += t.amount;
            else if(t.sender === address) balance -= t.amount;
        });
        return {addressTransactions: trans, addressBalance: balance};
    }

}

module.exports = Blockchain;