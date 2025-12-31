const mineflayer = require('mineflayer')

class AfkBot {
  constructor(opts) {
    this.opts = {
      viewDistance: 1,
      checkTimeoutInterval: 60_000,
      ...opts
    }

    this.bot = mineflayer.createBot({
      host: this.opts.host,
      port: this.opts.port,
      username: this.opts.name,
      auth: 'offline',
      viewDistance: this.opts.viewDistance,
      checkTimeoutInterval: this.opts.checkTimeoutInterval
    })

    this._wireEvents()
  }

  _wireEvents() {
    const bot = this.bot
    bot.once('spawn', () => this._onSpawn())
    bot.on('kicked', (r) => console.log(`[${this.opts.name}] Kicked:`, JSON.stringify(r, null, 4)))
    bot.on('error', (e) => console.log(`[${this.opts.name}] Error:`, e))
    bot.on('login', () => console.log(`[${this.opts.name}] Logged in`))
    bot.on('end', (reason) => console.log(`[${this.opts.name}] Ended:`, reason))
    bot.on('disconnect', (packet) => console.log(`[${this.opts.name}] Disconnect packet:`, packet))
  }

  _onSpawn() {
    const bot = this.bot
    const { x, y, z, world, skinUrl, name } = this.opts

    bot.clearControlStates()
    bot.chat(`/tppos ${x} ${y} ${z} ${world}`)

    if (skinUrl) {
      setTimeout(() => bot.chat(`/skin url "${skinUrl}" classic`), 2000)
    }

    this._idleInterval = setInterval(() => bot.clearControlStates(), 10_000)

    console.log(`[${name}] Spawned -> tppos ${x} ${y} ${z} ${world}`)
  }

  stop() {
    if (this._idleInterval) clearInterval(this._idleInterval)
    this.bot.end()
  }
}

module.exports = AfkBot
// or if you prefer named:
// module.exports = { AfkBot }
