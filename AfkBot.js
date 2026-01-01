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
      ...opts
    }

    this.bot = null
    this._idleInterval = null
    this._reconnectTimer = null
    this._attempt = 0
    this._stopped = false

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
      console.log(`[${name}] talkEnabled=false, not starting proximity talk`)
      return
    }

    if (this._talkInterval) clearInterval(this._talkInterval)

    const range = this.opts.talkRange
    const rangeSq = range * range
    const cooldown = this.opts.talkCooldownMs
    const phrases = this.opts.talkPhrases

    console.log(
      `[${name}] Proximity talk STARTED range=${range} blocks, scanMs=${this.opts.talkScanMs}, cooldownMs=${cooldown}`
    )

    // Helpful protocol-level debugging:
    // When a player entity appears/disappears client-side
    bot.on('entitySpawn', (ent) => {
      if (ent?.type === 'player') {
        console.log(`[${name}] entitySpawn player: ${ent.username} id=${ent.id} pos=${ent.position}`)
      }
    })
    bot.on('entityGone', (ent) => {
      if (ent?.type === 'player') {
        console.log(`[${name}] entityGone player: ${ent.username} id=${ent.id}`)
      }
    })

    // If you want to see tab-list updates too:
    bot.on('playerJoined', (p) => console.log(`[${name}] playerJoined(tab): ${p.username}`))
    bot.on('playerLeft', (p) => console.log(`[${name}] playerLeft(tab): ${p?.username}`))

    this._talkInterval = setInterval(() => {
      try {
        if (!bot?.entity?.position) {
          console.log(`[${name}] talk tick: bot has no position yet`)
          return
        }

        const now = Date.now()
        const botPos = bot.entity.position

        const playerEntities = Object.values(bot.entities).filter(e => e?.type === 'player')
        console.log(
          `[${name}] talk tick: botPos=${botPos} playerEntities=${playerEntities.length} players=[${playerEntities.map(e => e.username).join(', ')}]`
        )

        for (const ent of playerEntities) {
          const username = ent.username
          if (!username || username === bot.username) continue
          if (!ent.position) {
            console.log(`[${name}] skip ${username}: no ent.position`)
            continue
          }

          const d2 = distSq(botPos, ent.position)
          const inRangeNow = d2 <= rangeSq

          const state = this._nearState.get(username) ?? { inRange: false, lastSent: 0 }

          console.log(
            `[${name}] check ${username}: pos=${ent.position} d2=${d2.toFixed(2)} inRangeNow=${inRangeNow} prevInRange=${state.inRange} lastSentAgoMs=${now - state.lastSent}`
          )

          // ENTER
          if (inRangeNow && !state.inRange) {
            console.log(`[${name}] ENTER range: ${username}`)

            const canSend = phrases?.length && (now - state.lastSent) >= cooldown
            if (canSend) {
              const msg = `${username}, ${pickRandom(phrases)}`
              console.log(`[${name}] SENDING: ${msg}`)
              bot.chat(msg)
              state.lastSent = now
            } else {
              console.log(`[${name}] NOT sending (cooldown or no phrases). phrasesLen=${phrases?.length ?? 0}`)
            }

            state.inRange = true
            this._nearState.set(username, state)
            continue
          }

          // LEAVE
          if (!inRangeNow && state.inRange) {
            console.log(`[${name}] LEAVE range: ${username}`)
            state.inRange = false
            this._nearState.set(username, state)
          }
        }
      } catch (err) {
        console.log(`[${name}] talk tick ERROR:`, err)
      }
    }, this.opts.talkScanMs)
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
    this._clearTalk()
    this._nearState?.clear()
    this._destroyBot()
  }
}

module.exports = AfkBot
