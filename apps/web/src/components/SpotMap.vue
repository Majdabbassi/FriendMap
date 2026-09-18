<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type SpotMarker = {
  id: string
  lat: number
  lng: number
  label: string
  color?: string
}

const props = defineProps<{
  center?: { lat: number; lng: number } | null
  zoom?: number
  value?: { lat: number; lng: number } | null
  markers?: SpotMarker[]
}>()

const emit = defineEmits<{
  pick: [spot: { lat: number; lng: number }]
}>()

const mapElement = ref<HTMLElement | null>(null)

let map: L.Map | undefined
let pickMarker: L.Marker | undefined
let spotMarkers = new Map<string, L.Marker>()

function setupMap(): void {
  if (!mapElement.value || map) return

  map = L.map(mapElement.value, {
    zoomControl: false,
    attributionControl: false,
    zoomSnap: 0.5,
  }).setView(
    [props.center?.lat ?? 35.828, props.center?.lng ?? 10.64],
    props.zoom ?? 12,
  )

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(map)

  map.on('click', (event: L.LeafletMouseEvent) => {
    const { lat, lng } = event.latlng
    placePickMarker(lat, lng)
    emit('pick', { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 })
  })

  renderMarkers()
  renderValue()
}

function placePickMarker(lat: number, lng: number): void {
  if (!map) return
  pickMarker?.remove()
  const icon = L.divIcon({
    className: 'spot-pick',
    html: '<div class="spot-pick-dot"></div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
  pickMarker = L.marker([lat, lng], { icon }).addTo(map)
}

function renderValue(): void {
  if (props.value) {
    placePickMarker(props.value.lat, props.value.lng)
  }
}

function clearMarkers(): void {
  for (const [, marker] of spotMarkers) {
    marker.remove()
  }
  spotMarkers.clear()
}

function renderMarkers(): void {
  clearMarkers()
  if (!map) return
  for (const spot of props.markers ?? []) {
    const icon = L.divIcon({
      className: 'spot-marker',
      html: `<div class="spot-marker-bubble" style="background:${spot.color ?? 'var(--color-primary)'}">
        <span class="spot-marker-ring"></span>
      </div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    })
    const marker = L.marker([spot.lat, spot.lng], { icon }).addTo(map)
    marker.bindTooltip(spot.label, { direction: 'top', offset: [0, -14] })
    spotMarkers.set(spot.id, marker)
  }
}

watch(
  () => props.value,
  () => {
    renderValue()
  },
)

watch(
  () => props.markers,
  () => renderMarkers(),
  { deep: true },
)

onMounted(() => {
  setupMap()
})

onBeforeUnmount(() => {
  map?.remove()
  map = undefined
  pickMarker = undefined
  spotMarkers.clear()
})
</script>

<template>
  <div ref="mapElement" class="spot-map"></div>
</template>

<style scoped>
.spot-map {
  width: 100%;
  height: 260px;
  border-radius: 12px;
  overflow: hidden;
}

:deep(.spot-pick-dot) {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #e56b4f;
  border: 3px solid white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}

:deep(.spot-marker-bubble) {
  width: 16px;
  height: 16px;
  position: relative;
  border-radius: 50%;
  border: 2px solid white;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
}

:deep(.spot-marker-ring) {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 1px dashed rgba(229, 107, 79, 0.7);
}
</style>