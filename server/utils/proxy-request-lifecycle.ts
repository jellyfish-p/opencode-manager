import type { H3Event } from 'h3'

export interface ProxyRequestLifecycle {
  signal: AbortSignal
  dispose: () => void
}

export function createProxyRequestLifecycle(event: H3Event): ProxyRequestLifecycle {
  const controller = new AbortController()
  const request = event.node.req
  const response = event.node.res

  function dispose() {
    request.off('aborted', abort)
    response.off('close', onClose)
    response.off('finish', dispose)
  }
  function abort() {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException('Client disconnected', 'AbortError'))
    }
    dispose()
  }
  function onClose() {
    if (!response.writableFinished) abort()
    else dispose()
  }

  request.once('aborted', abort)
  response.once('close', onClose)
  response.once('finish', dispose)
  if (request.aborted) abort()

  return { signal: controller.signal, dispose }
}
