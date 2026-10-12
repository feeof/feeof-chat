'use strict';

/** Tracks how many live socket connections each agent and visitor has. */
class Presence {
  constructor() {
    this.agents = new Map();
    this.visitors = new Map();
  }

  static add(map, id) {
    const count = (map.get(id) || 0) + 1;
    map.set(id, count);
    return count === 1;
  }

  static remove(map, id) {
    const count = (map.get(id) || 0) - 1;
    if (count <= 0) {
      map.delete(id);
      return true;
    }
    map.set(id, count);
    return false;
  }

  /** Returns true when this is the agent's first connection. */
  addAgent(id) {
    return Presence.add(this.agents, id);
  }

  /** Returns true when the agent's last connection went away. */
  removeAgent(id) {
    return Presence.remove(this.agents, id);
  }

  isAgentOnline(id) {
    return this.agents.has(id);
  }

  addVisitor(id) {
    return Presence.add(this.visitors, id);
  }

  removeVisitor(id) {
    return Presence.remove(this.visitors, id);
  }

  isVisitorOnline(id) {
    return this.visitors.has(id);
  }
}

module.exports = { Presence };
