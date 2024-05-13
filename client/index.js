const events = require('events');
const util = require('util');
const nats = require('nats');

module.exports = class Client extends events.EventEmitter {

	constructor(nc = null, opts = {}) {
		super();

		this.opts = Object.assign({
			servers: '0.0.0.0:32803',
			maxPingOut: 3,
			maxReconnectAttempts: -1,
			pingInterval: 10000,
		}, opts);
		this.status = 'disconnected';
		this.nc = nc;

		if (nc) {
			this.waitStatus();
		}
	}

	isInitialized() {
		return (this.nc) ? true : false;
	}

	clone() {
		return new Client(this.nc, this.opts);
	}

	async connect() {
		let opts = {
			servers: this.opts.servers,
			user: this.opts.user,
			pass: this.opts.password,
			maxPingOut: this.opts.maxPingOut,
			maxReconnectAttempts: this.opts.maxReconnectAttempts,
			pingInterval: this.opts.pingInterval,
		};

		this.nc = await nats.connect(opts);
		this.waitStatus();

		// Updating states
		this.status = 'connected';
		this.emit('connected');
	}

	async disconnect() {
		if (!this.nc)
			return;

		await this.nc.close();
	}

	async waitStatus() {
		try {
			for await (const s of this.nc.status()) {
				switch(s.type) {
				case nats.Events.Disconnect:
					this.status = 'disconnected';
					this.emit('disconnect');
					break;
				case nats.Events.Reconnect:
					this.status = 'reconnecting';
					this.emit('connected');
					break;
				case nats.DebugEvents.Reconnecting:
					this.status = 'reconnecting';
					this.emit('reconnect');
					break;
				}
			}
		} catch(e) {
			console.log(e);
		}
	}

	async createStream(streamName, subjects = [], opts = {}) {

		let jsm = await this.nc.jetstreamManager();

		await jsm.streams.add(Object.assign(opts, {
			name: streamName,
			subjects: subjects
		}));
	}

	async ensureStream(streamName, subjects = [], opts = {}) {

		let jsm = await this.nc.jetstreamManager();

		try {
			let info = await jsm.streams.info(streamName)
		} catch(e) {

			// Not found
			if (e.code === '404') {
				return await this.createStream(streamName, subjects, opts);
			}

			throw e;
		}
	}

	async findStreamBySubject(subject) {

		let jsm = await this.nc.jetstreamManager();

		try {
			return await jsm.streams.find(subject)
		} catch(e) {
			throw e;
		}
	}

	async ensureConsumer(streamName, consumerName, opts = {}) {

		let jsm = await this.nc.jetstreamManager();

		try {
			let info = await jsm.consumers.info(streamName, consumerName)

			// Check consumer confiuration or update
			let updated = false;
			for (let k in opts) {

				if (k === 'name') {
					continue;
				}

				if (k === 'deliver_subject') {
					continue;
				}

				// Something's updated
				if (opts[k] != info.config[k]) {
					info.config[k] = opts[k];
					updated = true;
				}
			}

			if (updated) {
				console.log('updating', streamName, consumerName);
				await jsm.consumers.update(streamName, consumerName, info.config);
			}
			
		} catch(e) {

			// Not found
			if (e.code === '404') {

				opts.durable = consumerName;

				// Not found, so trying to create consumer
				return await jsm.consumers.add(streamName, opts);
			}

			throw e;
		}
	}

	async publish(subject, payload) {

		let js = this.nc.jetstream();

		await js.publish(subject, payload);
	}

	async publishString(subject, payload) {

		let js = this.nc.jetstream();
		let sc = nats.StringCodec();

		await js.publish(subject, sc.encode(payload));
	}

	async publishJSON(subject, payload = {}) {

		let js = this.nc.jetstream();
		let sc = nats.JSONCodec();

		await js.publish(subject, sc.encode(payload));
	}

	decode(data) {
		let sc = nats.StringCodec();

		return sc.decode(data);
	}

	async subscribe(subject, opts = {}, callback) {

		// Preparing consumer options
		let cOpts = nats.consumerOpts();
		cOpts.deliverTo(nats.createInbox());

		switch(opts.ack) {
		case 'auto':
			cOpts.ackNone();
			break;
		case 'all':
			cOpts.ackAll();
			break;
		case 'manual':
			cOpts.ackExplicit();
			cOpts.manualAck();
			break;
		}

		switch(opts.delivery) {
		case 'last':
			cOpts.deliverLast();
			break;
		case 'new':
			cOpts.deliverNew();
			break;
		case 'all':
			cOpts.deliverAll();
			break;
		case 'startSeq':
			cOpts.startSequence(opts.startSeq || 1);
			break;
		case 'startTime':
			cOpts.startTime(opts.startTime || new Date());
			break;
		}

		if (opts.ackWait) {
			cOpts.ackWait(opts.ackWait || 10000);
		}

		if (opts.maxAckPending) {
			cOpts.maxAckPending(opts.maxAckPending || 2000);
		}

		if (opts.durable) {
			cOpts.durable(opts.durable);
		}

		if (opts.queue && opts.durable) {
			cOpts.queue(opts.durable);

			// Find stream by subject
			let stream = await this.findStreamBySubject(subject);
			if (!stream) {
				throw new Error('no stream has specified subject');
			}

			// ensure consumer
			await this.ensureConsumer(stream, opts.durable, cOpts.config);
		}

		// Subscribe
		let js = this.nc.jetstream();
		let sub = await js.subscribe(subject, cOpts);

		console.log('[client]', subject, opts.durable);

		(async () => {
			for await (const m of sub) {
				callback(m);
			}
		})()

		return sub;
	}
}
