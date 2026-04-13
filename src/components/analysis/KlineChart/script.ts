import { defineComponent, ref, onMounted, watch, onBeforeUnmount, type PropType } from 'vue'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, type IChartApi, type ISeriesApi, ColorType } from 'lightweight-charts'
import type { KlineData } from '@/types'

export default defineComponent({
  name: 'KlineChart',
  props: {
    data: { type: Array as PropType<KlineData[]>, default: () => [] },
    height: { type: Number, default: 400 },
  },
  setup(props) {
    const chartContainer = ref<HTMLElement | null>(null)
    let chart: IChartApi | null = null
    let candleSeries: ISeriesApi<'Candlestick'> | null = null
    let volumeSeries: ISeriesApi<'Histogram'> | null = null
    let ma5Series: ISeriesApi<'Line'> | null = null
    let ma10Series: ISeriesApi<'Line'> | null = null
    let ma20Series: ISeriesApi<'Line'> | null = null
    let resizeObserver: ResizeObserver | null = null
    let lastRangeKey = ''

    function initChart() {
      if (!chartContainer.value) return
      chart = createChart(chartContainer.value, {
        width: chartContainer.value.clientWidth,
        height: props.height,
        layout: {
          background: { type: ColorType.Solid, color: '#ffffff' },
          textColor: '#5e6882',
        },
        grid: {
          vertLines: { color: 'rgba(226,230,239,0.6)' },
          horzLines: { color: 'rgba(226,230,239,0.6)' },
        },
        crosshair: {
          vertLine: { color: 'rgba(82,119,255,0.4)' },
          horzLine: { color: 'rgba(82,119,255,0.4)' },
        },
        rightPriceScale: {
          borderColor: 'rgba(226,230,239,0.8)',
          scaleMargins: {
            top: 0.08,
            bottom: 0.28,
          },
        },
        timeScale: { borderColor: 'rgba(226,230,239,0.8)', timeVisible: true },
      })

      candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#e84057',
        downColor: '#2ebd6e',
        borderUpColor: '#e84057',
        borderDownColor: '#2ebd6e',
        wickUpColor: '#e84057',
        wickDownColor: '#2ebd6e',
      })
      ma5Series = chart.addSeries(LineSeries, {
        color: '#095d95',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      ma10Series = chart.addSeries(LineSeries, {
        color: '#b7955f',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      ma20Series = chart.addSeries(LineSeries, {
        color: '#6f7d95',
        lineWidth: 2,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      volumeSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: 'volume',
        priceFormat: {
          type: 'volume',
        },
      })
      chart.priceScale('volume').applyOptions({
        scaleMargins: {
          top: 0.78,
          bottom: 0,
        },
        borderVisible: false,
      })

      updateData()

      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width } = entry.contentRect
          if (chart && width > 0) {
            chart.applyOptions({ width })
          }
        }
      })
      resizeObserver.observe(chartContainer.value)
    }

    function buildMovingAverage(period: number) {
      const result: Array<{ time: any; value: number }> = []
      for (let index = 0; index < props.data.length; index += 1) {
        if (index + 1 < period) continue
        const window = props.data.slice(index + 1 - period, index + 1)
        const sum = window.reduce((total, item) => total + item.close, 0)
        result.push({
          time: Math.floor(props.data[index].timestamp / 1000) as any,
          value: Number((sum / period).toFixed(2)),
        })
      }
      return result
    }

    function updateData() {
      if (!candleSeries || !volumeSeries || !ma5Series || !ma10Series || !ma20Series) return
      if (!props.data.length) {
        candleSeries.setData([])
        volumeSeries.setData([])
        ma5Series.setData([])
        ma10Series.setData([])
        ma20Series.setData([])
        return
      }
      const formatted = props.data.map((d) => ({
        time: (d.timestamp / 1000) as any,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }))
      const volumeData = props.data.map((item) => ({
        time: (item.timestamp / 1000) as any,
        value: item.volume,
        color: item.close >= item.open ? 'rgba(232, 64, 87, 0.45)' : 'rgba(46, 189, 110, 0.45)',
      }))
      candleSeries.setData(formatted)
      volumeSeries.setData(volumeData)
      ma5Series.setData(buildMovingAverage(5) as any)
      ma10Series.setData(buildMovingAverage(10) as any)
      ma20Series.setData(buildMovingAverage(20) as any)
      const first = props.data[0]?.timestamp ?? 0
      const last = props.data[props.data.length - 1]?.timestamp ?? 0
      const rangeKey = `${props.data.length}_${first}_${last}`
      if (rangeKey !== lastRangeKey) {
        chart?.timeScale().fitContent()
        lastRangeKey = rangeKey
      }
    }

    onMounted(() => { initChart() })

    watch(() => props.data, () => { updateData() })
    watch(() => props.height, (height) => {
      chart?.applyOptions({ height })
    })

    onBeforeUnmount(() => {
      resizeObserver?.disconnect()
      resizeObserver = null
      chart?.remove()
      chart = null
    })

    return { chartContainer }
  },
})
