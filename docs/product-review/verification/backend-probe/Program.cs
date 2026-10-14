using System.Reflection;
using System.Text.Json;
using Vessel.Application.Activity;
using Vessel.Application.Plays;
using Vessel.Application.Plays.Execution;
using Vessel.Application.Review;
using Vessel.Application.Sizing;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Markets;
using Vessel.Domain.Plays;
using Vessel.Domain.Sizing;
using Vessel.Domain.Workspace;

static class Probe {
 public static readonly DateTimeOffset Start=DateTimeOffset.Parse("2026-10-10T10:00:00Z");
 public static readonly Clock Time=new();
 public static readonly VenueRegistry Registry=new([],[],[],[],[],[]);
 public static PlayPlanDocument Plan()=>new("long","quantity","1","1",null,[new("e","Entry","#123456","100","100",[new("s","price","95","100")],[new("t","price","110","100")])],new("","","",""));
 public static MemoryStore Setup() {var s=new MemoryStore(); var p=new Play(Guid.NewGuid(),s.Account,new("hyperliquid","BTC"),InstrumentSource.Venue,PlayDocuments.Serialize(Plan()),Start);s.Add(p);s.Add(p.MarkPlanned(Start).Revision);return s;}
 public static ImportedOrder Order(MemoryStore s,string id,string side,decimal price,int minute,decimal size=1)=>new(){Id=Guid.NewGuid(),OwnerId=s.Account.OwnerId,AccountId=s.Account.Id,OrderId=id,ContractId="BTC",Side=side,OrderType="Limit",LimitPrice=price,OriginalSize=size,RemainingSize=0,PlacedAtUtc=Start.AddMinutes(minute),StatusAtUtc=Start.AddMinutes(minute),Status="filled",VenueStatus="filled"};
 public static ImportedFill Fill(MemoryStore s,string id,string side,string effect,decimal price,decimal qty,int minute,decimal pnl=0)=>new(){Id=Guid.NewGuid(),OwnerId=s.Account.OwnerId,AccountId=s.Account.Id,SourceFillId=id,OrderId=id,ContractId="BTC",Side=side,PositionEffect=effect,Price=price,Quantity=qty,OccurredAtUtc=Start.AddMinutes(minute),Fee=0,FeeToken="USDC",FeeBasis=ExecutionFacts.FeeReported,PnlBasis=ExecutionFacts.PnlGross,ClosedPnlUsd=pnl,Direction=""};
 public static PlayExecutionService Service(MemoryStore s)=>new(s,s,null!,Registry,Time);
 public static async Task Reconcile(MemoryStore s) { await (Task)typeof(PlayExecutionService).GetMethod("ReconcileAsync",BindingFlags.Instance|BindingFlags.NonPublic)!.Invoke(Service(s),[s.Account,new VenueOrderReadResult([],Time.GetUtcNow(),"test"),new Dictionary<string,decimal>(),CancellationToken.None])!; }
 public static ClosedPlayFacts Facts(MemoryStore s)=>new(s.Play,s.Revisions,s.Links.Where(l=>l.State==OrderLinkState.Linked).SelectMany(l=>s.Fills.Where(f=>f.OrderId==l.OrderId).Select(f=>new LinkedFill(l.Role,f))).ToList());
 public static async Task Result(string name,MemoryStore s,bool incomplete=false) { var state=await Service(s).GetAsync(s.Play.Id,default); var facts=Facts(s); var review=await new ReviewService(new ReviewMemory(new([], [s.Account],s.Play.Status==PlayStatus.Closed?[facts]:[],s.Play.Status==PlayStatus.Open?1:0,0,Start,incomplete?new HashSet<Guid>{s.Play.Id}:null)),Time).GetAsync(new("all"),default);var outcome=PlayOutcomeCalculator.Outcome(facts); var sizing=await new SizingService(new SizingMemory(s.Play.Status==PlayStatus.Closed?[facts]:[]),null!,Time).GetAsync(default); Console.WriteLine($"{name}: status={state.Status}; entered={state.Totals.EnteredQuantity}; exited={state.Totals.ExitedQuantity}; open={state.Totals.OpenQuantity}; reviewCount={review.Metrics.Count}; incomplete={review.Coverage.IncompleteExecutions}; sizingOutcome={outcome?.NetResult.ToString()??"null"}; sizingRisk={outcome?.PlannedRisk.ToString()??"null"}; sizingW/L/S={sizing.Record.Wins}/{sizing.Record.Losses}/{sizing.Record.Scratches}; links={string.Join(",",s.Links.Where(l=>l.State==OrderLinkState.Linked).Select(l=>$"{l.OrderId}:{l.Role}"))}"); }
 public static void Assert(bool condition,string label) {if(!condition)throw new Exception("FAILED: "+label);Console.WriteLine("PASS: "+label);}
 public static async Task Main() {
  // 1. Fixed-size 2-unit filled entry, one retained entry unit, one-unit partial exit.
  var s=Setup();s.Orders.AddRange([Order(s,"in","buy",100,1,2),Order(s,"out","sell",110,3)]);s.Fills.AddRange([Fill(s,"in","buy","open",100,1,2),Fill(s,"out","sell","close",110,1,4,10)]);await Reconcile(s);await Result("known missing entry before late fill",s,true);var late=Fill(s,"in","buy","open",100,1,2);late.SourceFillId="in-second";s.Fills.Add(late);await Reconcile(s);await Result("known missing entry after late fill",s);
  // 2. A matching planned target filled before this Play's opening order.
  s=Setup();s.Orders.AddRange([Order(s,"old-close","sell",110,1),Order(s,"in","buy",100,3)]);s.Fills.AddRange([Fill(s,"old-close","sell","close",110,1,2,10),Fill(s,"in","buy","open",100,1,4)]);await Reconcile(s);await Result("pre-entry planned target",s);
  // 3. Manual Link as exit accepts an extra buy/open, which actually increases the position.
  s=Setup();s.Orders.Add(Order(s,"in","buy",100,1));s.Fills.Add(Fill(s,"in","buy","open",100,1,2));await Reconcile(s);s.Orders.Add(Order(s,"increase","buy",102,3));s.Fills.Add(Fill(s,"increase","buy","open",102,1,4));await Service(s).LinkAsync(s.Play.Id,new("increase","exit"),default);await Result("same-side opening fill linked as exit",s);
  // 3b. A buy/close of an earlier short is not an opening fill for a new long.
  s=Setup();s.Orders.Add(Order(s,"close-short","buy",100,1));s.Fills.Add(Fill(s,"close-short","buy","close",100,1,2,5));await Reconcile(s);await Result("automatic entry from close-short",s);
  // 4. Closed Play permits unlink but disallows repair.
  s=Setup();s.Orders.AddRange([Order(s,"in","buy",100,1),Order(s,"out","sell",110,3)]);s.Fills.AddRange([Fill(s,"in","buy","open",100,1,2),Fill(s,"out","sell","close",110,1,4,10)]);await Reconcile(s);await Service(s).UnlinkAsync(s.Play.Id,s.Links.Single(l=>l.OrderId=="out").Id,default);await Result("closed Play after unlink exit",s);try {await Service(s).LinkAsync(s.Play.Id,new("out","exit"),default);}catch(WorkspaceException e){Console.WriteLine($"repair rejected: {e.StatusCode} {e.Message}");}
  // 5. Filled long Play can be revised to short; future sell exits no longer match.
  s=Setup();s.Orders.Add(Order(s,"in","buy",100,1));s.Fills.Add(Fill(s,"in","buy","open",100,1,2));await Reconcile(s);var ps=new PlayService(s,null!,Time);await ps.UpdateAsync(s.Play.Id,new(s.Play.Version,s.Account.Id,"BTC","venue","Changed direction",Plan() with {Direction="short",Entries=[Plan().Entries[0] with {Stops=[new("s","price","105","100")],Targets=[new("t","price","90","100")]}]},JsonDocument.Parse("{}").RootElement,"","Changed my mind"),default);s.Orders.Add(Order(s,"out","sell",110,3));s.Fills.Add(Fill(s,"out","sell","close",110,1,4,10));await Reconcile(s);await Result("filled long changed to short",s);
  // Protections: full history partial exits, concurrent ambiguity, old risk, fees and Activity.
  s=Setup();s.Orders.AddRange([Order(s,"in","buy",100,1,2),Order(s,"out","sell",110,3)]);s.Fills.AddRange([Fill(s,"in","buy","open",100,2,2),Fill(s,"out","sell","close",110,1,4,10)]);await Reconcile(s);Assert(s.Play.Status==PlayStatus.Open,"complete partial exit stays Open");
  var other=new Play(Guid.NewGuid(),s.Account,new("hyperliquid","BTC"),InstrumentSource.Venue,PlayDocuments.Serialize(Plan()),Start);other.MarkPlanned(Start);var candidates=ExecutionMatcher.Candidates(Order(s,"ambiguous","buy",100,1),[(s.Play,Plan()),(other,Plan())],(_,_)=>false,false);Assert(candidates.Count==2,"two concurrent matching Plays require confirmation");
  var ops=OperationAggregator.Aggregate(s.Fills);Assert(ops.Count==1&&ops[0].OpenQuantity=="1"&&ops[0].TotalExitedQuantity=="1","Activity retains partial exit within one open operation");
  s=Setup();s.Orders.AddRange([Order(s,"in","buy",100,1),Order(s,"out","sell",110,3)]);s.Fills.AddRange([Fill(s,"in","buy","open",100,1,2),Fill(s,"out","sell","close",110,1,4,10)]);
  s.Add(s.Play.ChangePlan(PlayDocuments.Serialize(Plan() with {Entries=[Plan().Entries[0] with {Stops=[new("s","price","90","100")]}]}),"Widened after entry",Start.AddMinutes(3))!);await Reconcile(s);var outcome=PlayOutcomeCalculator.Outcome(Facts(s))!;Assert(outcome.PlannedRisk==5&&outcome.RMultiple==2,"post-entry revision does not replace initial stop for R");
  s.Fills[0].Fee=.1m;s.Fills[1].Fee=.2m;Assert(PlayOutcomeCalculator.Outcome(Facts(s))!.NetResult==9.7m,"gross USDC fees subtracted once");s.Fills[0].ClosedPnlUsd=-.1m;s.Fills[1].ClosedPnlUsd=9.8m;s.Fills.ForEach(f=>f.PnlBasis=ExecutionFacts.PnlNetOfFee);Assert(PlayOutcomeCalculator.Outcome(Facts(s))!.NetResult==9.7m,"net-of-fee result not charged twice");
  s.Fills[0].PnlBasis=ExecutionFacts.PnlGross;s.Fills[0].FeeToken="HYPE";ops=OperationAggregator.Aggregate(s.Fills);Assert(ops.Single().NetResultUsd==null,"Activity unsupported gross fee is unknown, not zero");
  s=Setup();s.Fills.AddRange([Fill(s,"in","buy","open",100,1,1),Fill(s,"flip","sell","flip",110,3,2,10),Fill(s,"close","buy","close",100,2,3,20)]);s.Fills[1].Fee=3;ops=OperationAggregator.Aggregate(s.Fills);Assert(ops.Count==2&&ops.Sum(o=>decimal.Parse(o.NetResultUsd!))==27,"Activity flip preserves quantity allocation and fee/PnL totals");
  s=Setup();s.Orders.AddRange([Order(s,"in","buy",100,1),Order(s,"out","sell",100,3)]);s.Fills.AddRange([Fill(s,"in","buy","open",100,1,2),Fill(s,"out","sell","close",100,1,4,0)]);await Reconcile(s);var zeroReview=await new ReviewService(new ReviewMemory(new([], [s.Account],[Facts(s)],0,0,Start)),Time).GetAsync(new("all"),default);Assert(zeroReview.Metrics.Net=="0"&&zeroReview.Metrics.Scratches==1,"Review complete scratch is a real zero");var emptyReview=await new ReviewService(new ReviewMemory(new([], [s.Account],[],0,0,null)),Time).GetAsync(new("all"),default);Assert(emptyReview.Metrics.Net==null,"Review empty history is unknown");

 }
}
sealed class Clock:TimeProvider { public override DateTimeOffset GetUtcNow()=>DateTimeOffset.Parse("2026-10-13T10:00:00Z"); }
sealed class ReviewMemory(ReviewFacts facts):IReviewStore {public Task<ReviewFacts> ReadAsync(ReviewQuery query,DateTimeOffset asOf,CancellationToken ct)=>Task.FromResult(facts);}
sealed class MemoryStore:IPlayStore,IPlayExecutionStore {
 public Task<T> WithPlayLockAsync<T>(Guid id,Func<Task<T>> action,CancellationToken ct)=>action();
 public Task<List<PlayReviewRevision>> ReviewsAsync(Guid id,CancellationToken ct)=>Task.FromResult(new List<PlayReviewRevision>());
 public Task<List<PlayOrderLink>> LinkedPlanReferencesAsync(Guid id,CancellationToken ct)=>Task.FromResult(Links.Where(l=>l.PlayId==id&&l.State==OrderLinkState.Linked).ToList());
 public void Add(PlayReviewRevision revision){}
 public Account Account {get;}=new(Guid.NewGuid(),Guid.NewGuid(),"hyperliquid","Synthetic");public List<Play> Plays=[];public Play Play=>Plays.Single();public List<ImportedOrder> Orders=[];public List<ImportedFill> Fills=[];public List<PlayOrderLink> Links=[];public List<PlayPlanRevision> Revisions=[];public List<PlayStatusChange> Changes=[];
 public Task<List<Play>> ListAsync(CancellationToken ct)=>Task.FromResult(Plays);public Task<Play?> FindAsync(Guid id,CancellationToken ct)=>Task.FromResult(Plays.SingleOrDefault(p=>p.Id==id));public Task<Account?> AccountAsync(Guid id,CancellationToken ct)=>Task.FromResult<Account?>(Account);public Task<List<PlayPlanRevision>> RevisionsAsync(Guid id,CancellationToken ct)=>Task.FromResult(Revisions);public Task<List<PlayStatusChange>> StatusChangesAsync(Guid id,CancellationToken ct)=>Task.FromResult(Changes);
 public Task<IReadOnlySet<string>> FilledEntryIdsAsync(Guid id,CancellationToken ct)=>Task.FromResult<IReadOnlySet<string>>(Links.Where(l=>l.PlayId==id&&l.State==OrderLinkState.Linked&&l.Role==OrderLinkRole.Entry&&Fills.Any(f=>f.OrderId==l.OrderId)).Select(l=>l.EntryId!).ToHashSet());
 public void Add(Play p)=>Plays.Add(p);public void Add(PlayPlanRevision r)=>Revisions.Add(r);public void Add(PlayStatusChange c)=>Changes.Add(c);public void Add(PlayOrderLink l)=>Links.Add(l);public Task SaveAsync(CancellationToken ct)=>Task.CompletedTask;public Task<IReadOnlyList<string>> DeleteAsync(Play p,CancellationToken ct)=>Task.FromResult<IReadOnlyList<string>>([]);
 public Task<List<Play>> ActivePlaysAsync(Guid id,CancellationToken ct)=>Task.FromResult(Plays.Where(ExecutionMatcher.IsActive).ToList());public Task<List<ImportedOrder>> OrdersAsync(Guid id,CancellationToken ct)=>Task.FromResult(Orders.ToList());public Task<List<PlayOrderLink>> LinksAsync(Guid id,CancellationToken ct)=>Task.FromResult(Links.ToList());public Task<List<ImportedFill>> FillsAsync(Guid id,IReadOnlyCollection<string> ids,CancellationToken ct)=>Task.FromResult(Fills.Where(f=>ids.Contains(f.OrderId)).ToList());public Task UpsertOrdersAsync(Account account,IReadOnlyList<VenueOrder> orders,DateTimeOffset observedAt,CancellationToken ct)=>Task.CompletedTask;public Task<T> WithAccountLockAsync<T>(Guid id,Func<Task<T>> action,CancellationToken ct)=>action();
}

sealed class SizingMemory(List<ClosedPlayFacts> facts):ISizingStore { public Task<SizingSettings?> SettingsAsync(CancellationToken ct)=>Task.FromResult<SizingSettings?>(null);public Task<List<ClosedPlayFacts>> ClosedPlaysAsync(CancellationToken ct)=>Task.FromResult(facts);public void Add(SizingSettings s){}public Task SaveAsync(CancellationToken ct)=>Task.CompletedTask;}
