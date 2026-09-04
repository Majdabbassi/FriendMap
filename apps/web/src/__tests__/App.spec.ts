import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import App from '../App.vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/auth' }),
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: defineComponent({
    props: { to: { type: [String, Object], required: true } },
    setup(_, { slots }) {
      return () => h('a', slots.default?.())
    },
  }),
  RouterView: defineComponent({
    setup(_, { slots }) {
      return () => slots.default?.() ?? h('div', 'view')
    },
  }),
}))

describe('App', () => {
  it('renders the app shell', async () => {
    setActivePinia(createPinia())
    localStorage.removeItem('friendmap_token')

    const wrapper = mount(App)

    await flushPromises()

    expect(wrapper.find('.app-shell').exists()).toBe(true)
  })

  it('shows the identity topbar when authenticated', async () => {
    setActivePinia(createPinia())

    const payload = btoa(JSON.stringify({ username: 'alice' }))
    localStorage.setItem('friendmap_token', `header.${payload}.signature`)

    const wrapper = mount(App)

    await flushPromises()

    expect(wrapper.find('.topbar').exists()).toBe(true)
    expect(wrapper.text()).toContain('alice')
  })
})
