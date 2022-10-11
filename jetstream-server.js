
module.exports = function (RED) {

	function JetStreamServerNode(n) {
		RED.nodes.createNode(this, n)

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
	}

	RED.nodes.registerType('NATS JetStream Server', JetStreamServerNode)
}
