// In-memory network for tests: same star rules and async delivery as the real transport.

import { Emitter, type Transport, type TransportOptions } from './transport.ts';

interface Node {
  t: MemoryTransport;
  room: string;
  role: TransportOptions['role'];
  key: string;
}

export class MemoryNetwork {
  private nodes = new Set<Node>();
  private seq = 0;
  /** Messages in flight; tests await `settle()`. */
  private pending = 0;

  transport = (o: TransportOptions): Transport => {
    const t = new MemoryTransport(this, `peer${++this.seq}`);
    const node: Node = { t, room: o.code, role: o.role, key: o.key };
    // Connect to every compatible peer already in the room (star: host ⇄ member only).
    for (const other of this.nodes) {
      if (other.room !== node.room || other.role === node.role) continue;
      if (other.key !== node.key) { this.later(() => t.errors.emit('incorrect room password')); continue; }
      t.peers.add(other.t.selfId); other.t.peers.add(t.selfId);
      this.later(() => { other.t.joins.emit(t.selfId); t.joins.emit(other.t.selfId); });
    }
    this.nodes.add(node);
    t.node = node;
    return t;
  };

  remove(node: Node): void {
    if (!this.nodes.delete(node)) return;
    for (const other of this.nodes) {
      if (other.t.peers.delete(node.t.selfId)) this.later(() => other.t.leaves.emit(node.t.selfId));
    }
  }

  deliver(from: MemoryTransport, msg: unknown, to?: string): void {
    const copy = JSON.parse(JSON.stringify(msg)) as unknown; // like the wire: no shared references
    for (const other of this.nodes) {
      if (!from.peers.has(other.t.selfId) || (to && other.t.selfId !== to)) continue;
      this.later(() => { if (other.t.peers.has(from.selfId)) other.t.messages.emit(copy, from.selfId); });
    }
  }

  private later(fn: () => void): void {
    this.pending++;
    setTimeout(() => { this.pending--; fn(); }, 0);
  }

  /** Resolve once every in-flight message (and anything it triggered) is delivered. */
  async settle(): Promise<void> {
    for (let i = 0; i < 100 && this.pending > 0; i++) await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
  }
}

class MemoryTransport implements Transport {
  node?: Node;
  readonly peers = new Set<string>();
  readonly joins = new Emitter<[string]>();
  readonly leaves = new Emitter<[string]>();
  readonly messages = new Emitter<[unknown, string]>();
  readonly errors = new Emitter<[string]>();
  private readonly net: MemoryNetwork;
  readonly selfId: string;
  constructor(net: MemoryNetwork, selfId: string) { this.net = net; this.selfId = selfId; }
  onPeerJoin(cb: (p: string) => void) { this.joins.on(cb); }
  onPeerLeave(cb: (p: string) => void) { this.leaves.on(cb); }
  onMessage(cb: (m: unknown, p: string) => void) { this.messages.on(cb); }
  onError(cb: (e: string) => void) { this.errors.on(cb); }
  send(msg: unknown, to?: string) { this.net.deliver(this, msg, to); }
  leave() { if (this.node) this.net.remove(this.node); }
}
