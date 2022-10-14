
module.exports = function (RED) {

	function JetStreamStreamNode(config) {
		RED.nodes.createNode(this, config)
		
		let node = this;

		this.config = config;
		this.config.subjects = this.config.subjects ? this.config.subjects.split(',') : [];

		this.getOptions = () => {
			return {
				stream: this.config.stream,
				subjects: this.config.subjects || [],
				description: this.config.description,
				max_msgs: this.config.max_msgs || -1,
				max_age: this.config.max_age || 0,
				max_bytes: this.config.max_bytes || -1,
				num_replica: this.config.num_replicas || 1
			}
		};
	}

	RED.nodes.registerType('NATS JetStream Stream', JetStreamStreamNode)
}
