type AdminSubmissionFiltersProps = {
  status: string;
  query: string;
};

export function AdminSubmissionFilters({ status, query }: AdminSubmissionFiltersProps) {
  return (
    <form className="admin-filters">
      <label>
        <span>状态</span>
        <select name="status" defaultValue={status}>
          <option value="">全部状态</option>
          <option value="pending">待审核</option>
          <option value="approved">已批准</option>
          <option value="rejected">已驳回</option>
        </select>
      </label>
      <label>
        <span>搜索赛事或战队</span>
        <input type="search" name="q" defaultValue={query} />
      </label>
      <button type="submit">筛选</button>
    </form>
  );
}
