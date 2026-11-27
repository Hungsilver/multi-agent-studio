import type { DetailedHTMLProps, HTMLAttributes } from 'react'

export interface WebViewElement extends HTMLElement {
  src: string
  canGoBack: () => boolean
  canGoForward: () => boolean
  goBack: () => void
  goForward: () => void
  reload: () => void
  stop: () => void
  getURL: () => string
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<WebViewElement>, WebViewElement> & {
        src?: string
        partition?: string
        allowpopups?: string
      }
    }
  }
}

export {}
