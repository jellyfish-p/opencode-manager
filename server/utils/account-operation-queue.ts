export class AccountOperationQueue {
  private tails = new Map<number, Promise<void>>()

  run<T>(accountId: number, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(accountId) ?? Promise.resolve()
    const result = previous.then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.tails.set(accountId, tail)
    tail.then(() => {
      if (this.tails.get(accountId) === tail) this.tails.delete(accountId)
    })
    return result
  }
}
