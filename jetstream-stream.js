
module.exports = function (RED) {

	const sizeunit = {
		'bytes': 1,
		'kb': 1000,
		'mb': 1000000,
		'gb': 1000000000
	};

	const ageunit = {
		'millisecond': 1000000,
		'second': 1000000000,
		'minute': 60000000000,
		'hour': 3600000000000,
		'day': 86400000000000
	};

	function JetStreamStreamNode(config) {

		RED.nodes.createNode(this, config)
		let node = this;

		this.config = config;
		this.config.subjects = this.config.subjects ? this.config.subjects.split(',') : [];
		this.config.max_msgs = Number(this.config.max_msgs) || -1;
		this.config.num_replicas = Number(this.config.num_replicas) || 1;

		if (Number(this.config.max_size) > 0) {
			this.config.max_bytes = Number(this.config.max_size) * sizeunit[this.config.max_sizeunit];
		} else {
			this.config.max_bytes = -1;
		}

		if (Number(this.config.max_age) > 0) {
			this.config.max_age = Number(this.config.max_age) * ageunit[this.config.max_ageunit];
		} else {
			this.config.max_age = 0;
		}

		this.getOptions = () => {
			return {
				name: this.config.stream,
				description: this.config.description,
				subjects: this.config.subjects,
				max_msgs: this.config.max_msgs,
				max_age: this.config.max_age,
				max_bytes: this.config.max_bytes,
				num_replica: this.config.num_replicas,
			}
		};
	}

	RED.nodes.registerType('NATS JetStream Stream', JetStreamStreamNode)
}
