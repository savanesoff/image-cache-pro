import { Logger } from './logger'

describe('Logger', () => {
  let logger: Logger
  beforeEach(() => {
    logger = new Logger({ logLevel: 'verbose' })
  })

  it('should have name: Logger', () => {
    expect(logger.name).toBe('Logger')
  })

  it('should have logLevel: verbose', () => {
    expect(logger.level).toBe('verbose')
  })

  describe('setLogLevel', () => {
    it('should set logLevel', () => {
      logger.setLogLevel('info')
      expect(logger.level).toBe('info')
    })
  })
})
