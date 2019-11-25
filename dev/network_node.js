const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const rp = require('request-promise');
const Blockchain = require('./blockchain');
const uuid = require('uuid/v1');
const PORT = process.argv[2];


const bitcoin = new Blockchain();
const nodeAddress = uuid().split('-').join('');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

app.get('/block-explorer', function(req, res){
    return res.sendFile('./block-explorer/index.html', {root: __dirname});
})

app.get('/blockchain', (req, res) => {
    return res.send(bitcoin);
});

app.post('/transaction', (req, res) => {
    const newTransaction = req.body;
    const blockIndex = bitcoin.addTransactionToPendingTransactions(newTransaction);
    res.json({ msg: `Transaction will be added in the block ${blockIndex}`});
});

app.post('/transaction/broadcast', function(req, res){
    const newTransaction = bitcoin.createNewTransaction(req.body.amount, req.body.sender, req.body.recipient);
    bitcoin.addTransactionToPendingTransactions(newTransaction);

    const requestPromises = [];
    bitcoin.networkNodes.forEach(node => {
        const requestOptions = {
            uri: node + '/transaction',
            method: 'POST',
            body: newTransaction,
            json: true
        };
        if(bitcoin.currentNodeUrl !== node)requestPromises.push(rp(requestOptions));
    });

    Promise.all(requestPromises)
    .then(data => {
        res.json({ msg: 'Transaction created and broadcasted successfully!'});
    });
})

app.get('/mine', (req, res) => {
    const previousBlockHash = bitcoin.getLastBlock()['hash'];
    const currentBlockData = {
        transactions : bitcoin.pendingTransactions,
        index: bitcoin.getLastBlock()['index'] + 1
    };

    const nonce = bitcoin.proofOfWork(previousBlockHash, currentBlockData);
    const blockHash = bitcoin.hashBlock(previousBlockHash, currentBlockData, nonce);
    
    bitcoin.createNewTransaction(12.5, '00', nodeAddress);

    const newBlock = bitcoin.createNewBlock(nonce, previousBlockHash, blockHash);

    const requestPromises = [];
    bitcoin.networkNodes.forEach(node => {
        const requestOptions = {
            uri: node + '/receive-new-block',
            method: 'POST',
            body: {newBlock: newBlock},
            json: true
        };
        requestPromises.push(rp(requestOptions));
    });
    Promise.all(requestPromises)
    .then(data => {
        console.log(data);
        const requestOptions = {
            uri: bitcoin.currentNodeUrl + '/transaction/broadcast',
            method: 'POST',
            body: {
                amount: 12.5,
                sender: '00',
                recipient: nodeAddress
            },
            json: true
        }
        return rp(requestOptions);
    })
    .then(data => {
        res.json({
            msg: "New block mined and broadcasted successfully",
            details: newBlock
        })
    })
    .catch(err => console.error(err));
});

app.post('/receive-new-block', function(req, res){
    const newBlock = req.body.newBlock;
    const lastBlock = bitcoin.getLastBlock();
    const correctHash = newBlock.previousBlockHash === lastBlock.hash;
    const correctIndex = lastBlock['index']+1 === newBlock['index'];
    console.log(correctIndex, correctHash, lastBlock, newBlock)
    if(correctHash && correctIndex) {
        bitcoin.chain.push(newBlock);
        bitcoin.pendingTransactions = [];
        res.json({
            msg: "New block received and accepted!",
            newBlock
        })
    } else {
        res.json({
            msg: "New block rejected!",
            newBlock
        })
    }
})

// register a node and broadcast it the network
app.post('/register-and-broadcast-node', function(req, res) {
	const newNodeUrl = req.body.newNodeUrl;
	if(bitcoin.networkNodes.indexOf(newNodeUrl) == -1 && bitcoin.currentNodeUrl != newNodeUrl) bitcoin.networkNodes.push(newNodeUrl);

	const regNodesPromises = [];
	bitcoin.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/register-node',
			method: 'POST',
			body: { newNodeUrl: newNodeUrl },
			json: true
		};

		regNodesPromises.push(rp(requestOptions));
	});

	Promise.all(regNodesPromises)
	.then(data => {
		const bulkRegisterOptions = {
			uri: newNodeUrl + '/register-nodes-bulk',
			method: 'POST',
			body: { allNetworkNodes: [ ...bitcoin.networkNodes, bitcoin.currentNodeUrl ] },
			json: true
		};

		return rp(bulkRegisterOptions);
	})
	.then(data => {
		res.json({ note: 'New node registered with network successfully.' });
	});
});


// register a node with the network
app.post('/register-node', function(req, res) {
	const newNodeUrl = req.body.newNodeUrl;
	const nodeNotAlreadyPresent = bitcoin.networkNodes.indexOf(newNodeUrl) == -1;
	const notCurrentNode = bitcoin.currentNodeUrl != newNodeUrl;
	if(nodeNotAlreadyPresent && notCurrentNode) bitcoin.networkNodes.push(newNodeUrl);
	res.json({ note: 'New node registered successfully.' });
});


// register multiple nodes at once
app.post('/register-nodes-bulk', function(req, res) {
	const allNetworkNodes = req.body.allNetworkNodes;
	allNetworkNodes.forEach(networkNodeUrl => {
		const nodeNotAlreadyPresent = bitcoin.networkNodes.indexOf(networkNodeUrl) == -1;
		const notCurrentNode = bitcoin.currentNodeUrl != networkNodeUrl;
		if(nodeNotAlreadyPresent && notCurrentNode) bitcoin.networkNodes.push(networkNodeUrl);
	});

	res.json({ note: 'Bulk registration successful.' });
});

app.get('/consensus', function(req, res){
    const requestPromises = [];
    bitcoin.networkNodes.forEach(networkNodeUrl => {
        const requestOptions = {
            uri: networkNodeUrl + '/blockchain',
            method: 'GET',
            json: true
        };
        requestPromises.push(rp(requestOptions));
    })
    Promise.all(requestPromises)
    .then(blockchains => {
        const currentChainLength = bitcoin.chain.length;
        let maxChainLength = currentChainLength;
        let newLongestChain = null;
        let newPendingTransactions = null;
        blockchains.forEach(blockchain => {
            if(blockchain.chain.length > maxChainLength){
                maxChainLength = blockchain.chain.length;
                newLongestChain = blockchain.chain;
                newPendingTransactions = blockchain.pendingTransactions;
            };
            console.log(maxChainLength, newLongestChain, newPendingTransactions);
            if(!newLongestChain || (newLongestChain && !bitcoin.chainIsValid(blockchain))){
                return res.json({ 
                    msg: 'Current chain has not been replaced',
                    chain: bitcoin.chain
                });
            } 
            else{
                bitcoin.chain = newLongestChain;
                bitcoin.pendingTransactions = newPendingTransactions;
                return res.json({
                    msg: 'This chain has been replaced',
                    chain: bitcoin.chain
                })
            }
        })
    })
    .catch(err => console.log(err));
});

app.get('/block/:blockHash', function(req, res){
    const block = bitcoin.getBlock(req.params.blockHash);
    if(!block) return res.json({msg: 'Block not found!'})
    else return res.json({ msg: 'Block found!', block });
});

app.get('/address/:address', function(req, res){
    const response = bitcoin.getAddressData(req.params.address);
    console.log(response);
    return res.json({ addressData: response})
});

app.get('/transaction/:transactionId', function(req, res){
    const response = bitcoin.getTransaction(req.params.transactionId);
    if(response.transaction === undefined){
        return res.json({msg: 'Transaction not found!'})
    } else {
        return res.json({ 
            msg: 'Transaction found!',
            transaction: response.transaction,
            block: response.blockFound
        });
    }
});

app.listen(PORT, ()=> console.log(`Listening on ${PORT}!`))