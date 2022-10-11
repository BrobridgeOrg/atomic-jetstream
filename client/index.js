const events = require('events');
const util = require('util');
const nats = require('nats');

module.exports = class Client extends events.EventEmitter {

	constructor(opts = {}) {
		super();

		this.opts = Object.assign({
			servers: '0.0.0.0:32803',
			maxPingOut: 3,
			maxReconnectAttempts: -1,
			pingInterval: 10000,
		}, opts);
		this.nc = null;
	}

	async connect() {
		let opts = {
			servers: this.opts.servers,
			maxPingOut: this.opts.maxPingOut,
			maxReconnectAttempts: this.opts.maxReconnectAttempts,
			pingInterval: this.opts.pingInterval,
		};
		this.nc = await nats.connect(opts);

		// Updating states
		this.emit('connected');

		(async () => {
			for await (const s of this.nc.status()) {
				switch(s) {
				case nats.Events.DISCONNECT:
					this.emit('disconnect');
				case nats.Events.RECONNECT:
					this.emit('reconnect');
				}
			}
		})()
	}

	async disconnect() {
		if (!this.nc)
			return;

		await this.nc.close();
	}

	getDomain() {
		return this.opts.domain;
	}

	getConnectionStates() {
		return this.connStates;
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

	async subscribe(subject, durable, opts = {}, callback) {

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

		if (durable) {
			cOpts.durable(durable);
		}

		// Subscribe
		let js = this.nc.jetstream();

		let sub = await js.subscribe(subject, cOpts);

		(async () => {
			for await (const m of sub) {
				callback(m);
			}
		})()

		return sub;
	}
}
