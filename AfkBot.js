const mineflayer = require('mineflayer')

const DEFAULT_PHRASES = [
  "Buenas",
  "Ya vamonos que aqui espantan",
  "Trabajando duro o durando en el trabajo? jaja",
  "A chambear pa"
]

// fast: no sqrt
function distSq(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function pickRandom(arr) {
  return arr[(Math.random() * arr.length) | 0]
}

class AfkBot {
  constructor(opts) {
    this.opts = {
      viewDistance: 1,
      checkTimeoutInterval: 60_000,
      auth: 'offline',
      reconnect: true,
      baseReconnectMs: 10_000,   // first retry delay
      maxReconnectMs: 5 * 60_000, // cap

      // proximity talk
      talkEnabled: true,
      talkRange: 6,            // blocks
      talkCooldownMs: 5 * 60_000, // 5 min
      talkScanMs: 1500,        // scan interval
      talkPhrases: DEFAULT_PHRASES,

      autoSleepEnabled: true,
      sleepBedMaxDistance: 3,
      ...opts
    }

    this.bot = null
    this._idleInterval = null
    this._reconnectTimer = null
    this._attempt = 0
    this._stopped = false
    this._poseState = new Map()         // username -> lastPoseValue
    this._sleepingPlayers = new Set()   // usernames currently detected sleeping

    this._connect()
  }

  _connect() {
    if (this._stopped) return

    this._clearReconnect()
    this._clearIdle()
    this._clearTalk()
    this._destroyBot()

    if (!this._nearState) this._nearState = new Map()
    else this._nearState.clear()

    this.bot = mineflayer.createBot({
      host: this.opts.host,
      port: this.opts.port,
      username: this.opts.name,
      auth: this.opts.auth,
      viewDistance: this.opts.viewDistance,
      checkTimeoutInterval: this.opts.checkTimeoutInterval
    })
    this._nearState = new Map() // username -> { inRange: bool, lastSent: number }

    this._wireEvents()
  }

  _wireEvents() {
    const bot = this.bot
    const name = this.opts.name

    bot.once('spawn', () => this._onSpawn())
    bot.on('login', () => console.log(`[${name}] Logged in`))

    bot.on('kicked', (r) => {
      console.log(`[${name}] Kicked:`, typeof r === 'string' ? r : JSON.stringify(r, null, 2))
      this._scheduleReconnect('kicked')
    })

    bot.on('end', (reason) => {
      console.log(`[${name}] Ended:`, reason)
      this._scheduleReconnect('end')
    })

    bot.on('disconnect', (packet) => {
      console.log(`[${name}] Disconnect packet:`, packet)
      // usually followed by 'end', but harmless
    })

    bot.on('error', (e) => {
      console.log(`[${name}] Error:`, e?.message ?? e)
      // many errors lead to 'end' anyway
    })

    bot.on('playerLeft', (player) => {
      const u = player?.username
      if (u) this._nearState.delete(u)
    })

    bot.on('chat', async (username, message) => {
      if (username === bot.username) return

      const msg = message.toLowerCase()

      // trigger on substring "sleep" anywhere
      if (msg.includes('sleep')) {
        console.log(`[${this.opts.name}] sleep trigger from ${username}: ${message}`)
        await this._trySleep(`chat trigger by ${username}`)
      }

      // optional: wake trigger
      if (msg.includes('wake')) {
        console.log(`[${this.opts.name}] wake trigger from ${username}: ${message}`)
        this._tryWake(`chat trigger by ${username}`)
      }
    })
  }

  _onSpawn() {
    const bot = this.bot
    const { x, y, z, world, skinUrl, name } = this.opts

    this._attempt = 0 // reset backoff once successfully joined

    bot.clearControlStates()
    bot.chat(`/tppos ${x} ${y} ${z} ${world}`)

    // Apply skin if provided (or keep your hardcoded one)
    const urlToUse = skinUrl ?? 'https://minesk.in/7904d8b03d7546b196d91c3e0c84381c'
    setTimeout(() => {
      if (!this.bot) return
      this.bot.chat(`/skin url "${urlToUse}" classic`)
    }, 2000)

    this._idleInterval = setInterval(() => {
      if (!this.bot) return
      this.bot.clearControlStates()
    }, 10_000)

    // start proximity greeter (still low CPU)
    this._startProximityTalk()

    console.log(`[${name}] Spawned -> tppos ${x} ${y} ${z} ${world}`)
  }

  _startProximityTalk() {
    const bot = this.bot
    const name = this.opts.name
    if (!this.opts.talkEnabled) {
      return
    }

    if (this._talkInterval) clearInterval(this._talkInterval)

    const range = this.opts.talkRange
    const rangeSq = range * range
    const cooldown = this.opts.talkCooldownMs
    const phrases = this.opts.talkPhrases


    this._talkInterval = setInterval(() => {
      try {
        if (!bot?.entity?.position) {
          return
        }

        const now = Date.now()
        const botPos = bot.entity.position

        const playerEntities = Object.values(bot.entities).filter(e => e?.type === 'player')

        for (const ent of playerEntities) {
          const username = ent.username
          if (!username || username === bot.username) continue
          if (!ent.position) {
            continue
          }

          const d2 = distSq(botPos, ent.position)
          const inRangeNow = d2 <= rangeSq

          const state = this._nearState.get(username) ?? { inRange: false, lastSent: 0 }

          // ENTER
          if (inRangeNow && !state.inRange) {

            const canSend = phrases?.length && (now - state.lastSent) >= cooldown
            if (canSend) {
              bot.chat(`/tell ${username} ${pickRandom(phrases)}`)
              state.lastSent = now
            }

            state.inRange = true
            this._nearState.set(username, state)
            continue
          }

          // LEAVE
          if (!inRangeNow && state.inRange) {
            state.inRange = false
            this._nearState.set(username, state)
          }
        }
      } catch (err) {
        console.log(`[${name}] talk tick ERROR:`, err)
      }
    }, this.opts.talkScanMs)
  }

  async _trySleep(reason = '') {
    const bot = this.bot
    if (!bot) return

    // nether/end safety (beds don't work)
    if (bot.game?.dimension && bot.game.dimension !== 'minecraft:overworld') {
      console.log(`[${this.opts.name}] skip sleep (${reason}) dimension=${bot.game.dimension}`)
      return
    }

    // already sleeping?
    if (bot.isSleeping) {
      console.log(`[${this.opts.name}] already sleeping (${reason})`)
      return
    }

    try {
      const bed = bot.findBlock({
        matching: block => bot.isABed(block),
        maxDistance: this.opts.sleepBedMaxDistance
      })

      if (!bed) {
        console.log(`[${this.opts.name}] no bed found within ${this.opts.sleepBedMaxDistance} (${reason})`)
        return
      }

      console.log(`[${this.opts.name}] trying sleep (${reason}) bed=${bed.position}`)
      await bot.sleep(bed)
      console.log(`[${this.opts.name}] now sleeping ✅`)
    } catch (e) {
      console.log(`[${this.opts.name}] sleep failed (${reason}):`, e?.message ?? e)
    }
  }

  _tryWake(reason = '') {
    const bot = this.bot
    if (!bot) return
    try {
      if (!bot.isSleeping) return
      bot.wake()
      console.log(`[${this.opts.name}] woke up (${reason})`)
    } catch (e) {
      console.log(`[${this.opts.name}] wake failed (${reason}):`, e?.message ?? e)
    }
  }




  _scheduleReconnect(reason) {
    if (this._stopped) return
    if (!this.opts.reconnect) return
    if (this._reconnectTimer) return // already scheduled

    this._attempt++

    // exponential backoff with jitter, capped
    const base = Math.min(this.opts.baseReconnectMs * (2 ** (this._attempt - 1)), this.opts.maxReconnectMs)
    const jitter = Math.floor(Math.random() * 3000) // 0-3s
    const waitMs = base + jitter

    console.log(`[${this.opts.name}] Reconnecting in ${Math.round(waitMs / 1000)}s (${reason})...`)

    this._clearIdle()
    this._destroyBot()
    this._clearTalk()
    this._poseState?.clear?.()
    this._sleepingPlayers?.clear?.()
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      this._connect()
    }, waitMs)
  }

  _destroyBot() {
    if (!this.bot) return
    try { this.bot.removeAllListeners() } catch { }
    try { this.bot.quit() } catch { } // quit is usually cleaner than end()
    this.bot = null
  }

  _clearIdle() {
    if (this._idleInterval) clearInterval(this._idleInterval)
    this._idleInterval = null
  }

  _clearReconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
    this._reconnectTimer = null
  }

  _clearTalk() {
    if (this._talkInterval) clearInterval(this._talkInterval)
    this._talkInterval = null
  }

  stop() {
    this._stopped = true
    this._clearReconnect()
    this._clearIdle()
    this._poseState?.clear?.()
    this._sleepingPlayers?.clear?.()
    this._clearTalk()
    this._nearState?.clear()
    this._destroyBot()
  }
}

module.exports = AfkBot
