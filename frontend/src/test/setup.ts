import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
// JSDOM has no scrolling engine; emulate this browser API at the DOM boundary.
if(!Element.prototype.scrollTo) Object.defineProperty(Element.prototype,'scrollTo',{configurable:true,value:function(this:Element,options:ScrollToOptions){this.scrollTop=options.top??this.scrollTop;this.scrollLeft=options.left??this.scrollLeft}})
afterEach(() => { cleanup(); localStorage.clear(); document.documentElement.scrollTop=0 })
