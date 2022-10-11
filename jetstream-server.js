
module.exports = function (RED) {

	function JetStreamServerNode(n) {
		RED.nodes.createNode(this, n)
		
		let node = this;

		this.clients = {};

		this.server = n.server
		this.port = n.port
		this.maxPingOut = 3;
		this.maxReconnectAttempts -1;
		this.pingInterval = 10000;

		this.getOpts = function() {
			return {
				server: this.server + ':' + this.port,
				maxPingOut: this.maxPingOut,
				maxReconnectAttempts: this.maxReconnectAttempts,
				pingInterval: this.pingInterval
			}
		};

		this.getClient = async function(clientID) {

			if (clientID == undefined)
				clientID = 'default';

			let client = node.clients[clientID];
			if (!client) {
				client = await createClient();
				node.clients[clientID] = client;
			}

			return client;
		};

		async function createClient() {
			let Client = require('./client');
			let client = new Client(node.getOpts());

			node.log('Connecting to JetStream server:' + node.getOpts().server)

			// Connect to JetStream Cluster
			await client.connect()

			return client;
		}
	}

	RED.nodes.registerType('NATS JetStream Server', JetStreamServerNode)
}
