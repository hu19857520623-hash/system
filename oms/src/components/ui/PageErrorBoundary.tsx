import { Component, type ErrorInfo, type ReactNode } from 'react'

export class PageErrorBoundary extends Component<{ children: ReactNode; hashRouting?: boolean }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch(error: Error, info: ErrorInfo) { console.error('页面显示失败', error, info) }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="mx-auto mt-16 max-w-lg rounded-xl border border-border bg-white p-6" role="alert">
        <h1 className="text-xl font-semibold">页面暂时无法显示</h1>
        <p className="my-4 text-sm text-text-secondary">请重新加载页面；如仍无法打开，可返回首页重新进入，或联系管理员。</p>
        <div className="flex gap-3">
          <button type="button" className="rounded-lg bg-primary-600 px-4 py-2 text-white" onClick={() => window.location.reload()}>重新加载</button>
          <a className="rounded-lg border border-border px-4 py-2" href={this.props.hashRouting ? '#/' : '/'}
            onClick={this.props.hashRouting ? event => {
              event.preventDefault()
              window.location.hash = '/'
              window.location.reload()
            } : undefined}>返回首页</a>
        </div>
      </main>
    )
  }
}
