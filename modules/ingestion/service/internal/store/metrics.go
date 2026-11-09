package store

import (
	"context"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	ingestionv1 "github.com/christoph/kb/modules/ingestion/api/go/ingestionv1"
)

// The ingestion service's job metrics (docs/metrics.md).
var jobTransitions = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "kb_ingestion_job_transitions_total",
	Help: "Jobs that entered a status: created (pending_upload), queued, processing, done or failed.",
}, []string{"status"})

var jobsDesc = prometheus.NewDesc(
	"kb_ingestion_jobs",
	"Jobs per status in the database, counted at scrape time (queue depth: status=\"queued\").",
	[]string{"status"}, nil,
)

// statusLabel turns JOB_STATUS_PENDING_UPLOAD into "pending_upload".
func statusLabel(s ingestionv1.JobStatus) string {
	return strings.ToLower(strings.TrimPrefix(s.String(), "JOB_STATUS_"))
}

func countTransition(job IngestionJob) {
	jobTransitions.WithLabelValues(statusLabel(ingestionv1.JobStatus(job.Status))).Inc()
}

// JobsCollector reports kb_ingestion_jobs from the database on every scrape.
// Every replica reports the same totals; aggregate them with max, not sum.
type JobsCollector struct{ q Querier }

func NewJobsCollector(q Querier) *JobsCollector { return &JobsCollector{q: q} }

func (c *JobsCollector) Describe(ch chan<- *prometheus.Desc) { ch <- jobsDesc }

// Collect reports every status, 0 for those without jobs. While the database
// is unreachable it reports an error instead, which leaves only this metric
// out of the scrape (metrics.Handler).
func (c *JobsCollector) Collect(ch chan<- prometheus.Metric) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	rows, err := c.q.CountJobsByStatus(ctx)
	if err != nil {
		ch <- prometheus.NewInvalidMetric(jobsDesc, err)
		return
	}
	counts := map[ingestionv1.JobStatus]int64{}
	for _, row := range rows {
		counts[ingestionv1.JobStatus(row.Status)] = row.Jobs
	}
	for value := range ingestionv1.JobStatus_name {
		status := ingestionv1.JobStatus(value)
		if status == ingestionv1.JobStatus_JOB_STATUS_UNSPECIFIED {
			continue
		}
		ch <- prometheus.MustNewConstMetric(jobsDesc, prometheus.GaugeValue, float64(counts[status]), statusLabel(status))
	}
}
