
module.exports = function (RED) {

	function JetStreamServerNode(n) {
		RED.nodes.createNode(this, n)
		
		let node = this;

		let timeoutID=0;

		const events = require('events');

		this.instance = new events.EventEmitter();
		this.client = null;
		this.dependencies = 0;
		this.status = 'disconnected';

		// Options
		this.server = n.server
		this.port = n.port
		this.user = n.user
		this.password = n.password
		this.maxPingOut = 3;
		this.maxReconnectAttempts = -1;
		this.pingInterval = 10000;

		// Create original client
		let Client = require('./client');
		this.client = new Client(null, {
			user: this.user,
			password: this.password,
			servers: this.server + ':' + this.port,
			maxPingOut: this.maxPingOut,
			maxReconnectAttempts: this.maxReconnectAttempts,
			pingInterval: this.pingInterval
		});

		// Setup events
		this.client.on('disconnect', () => {
			this.status = 'disconnected';
			node.log('Disconnected from server: ' + node.server + ':' + node.port);
		});

		this.client.on('reconnect', () => {
			this.status = 'reconnecting';
			node.log('Reconnecting to server: ' + node.server + ':' + node.port);
		});

		this.client.on('connected', () => {
			node.log('Connected to JetStream server: ' + node.server + ':' + node.port);
			this.status = 'connected';
		});

		connect()

		this.getInstance = () => {
			return node.instance;
		}

		this.allocateClient = function() {
			node.dependencies++;

			// Clone a client
			let client = node.client.clone();

			return client;
		}

		this.releaseClient = function() {
			node.dependencies--;
		}

		this.getOpts = function() {
			return {
				servers: this.server + ':' + this.port,
				maxPingOut: this.maxPingOut,
				maxReconnectAttempts: this.maxReconnectAttempts,
				pingInterval: this.pingInterval
			}
		};


    node.on('close', () => {
      clearTimeout(timeoutID);
    });

		function connect() {
                        clearTimeout(timeoutID);
			node.log('Connecting to JetStream server: ' + node.server + ':' + node.port);
			node.client.connect()
				.then(() => {
					node.once('close', async () => {
						try {
							await node.client.disconnect();
						} catch(e) {
							console.log(e);
						}
					});
					node.instance.emit('ready');
				})
				.catch((e) => {
					node.log('Failed to connect to JetStream server')
					console.log(e);
					node.error(e);

					// retry
					timeoutID = setTimeout(function(){
						connect();
					}, 3000);

				});
		};

	}

	RED.nodes.registerType('NATS JetStream Server', JetStreamServerNode)
}
