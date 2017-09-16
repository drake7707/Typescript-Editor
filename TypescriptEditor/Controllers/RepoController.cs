using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using TypescriptEditorHandler;
using Microsoft.Extensions.Options;
using System.Text;
using Microsoft.Extensions.Logging;

namespace TypescriptEditor.Controllers
{


    [Route("api/repo")]
    public class RepoController : Controller
    {

        private RepoMapper mapper;
        private readonly ILogger logger;
        private string repoPath;

        public RepoController(IOptions<RepoSettings> settings, ILogger<RepoController> logger)
        {
            repoPath = settings.Value.RepoPath;
            mapper = new RepoMapper(System.IO.Path.Combine(repoPath, "repo.db"));
            this.logger = logger;
        }

        [HttpGet("test")]
        public IActionResult Test()
        {
            return Json(new { test = "test" });
        }

        [HttpGet("output/{id}/{milestone}")]
        public IActionResult Output(string id, string milestone)
        {
            var entry = mapper.GetEntry(id);
            if (entry != null)
            {
                int milestoneInt;
                if (!int.TryParse(milestone, out milestoneInt))
                    milestoneInt = entry.LastMilestone;
                else
                {
                    if (milestoneInt >= 1 && milestoneInt <= entry.LastMilestone)
                    {
                        // ok
                    }
                    else
                        milestoneInt = entry.LastMilestone;
                }

                var path = System.IO.Path.Combine(repoPath, entry.Key);

                if (!System.IO.Directory.Exists(path))
                    return NotFound();

                string filename;
                filename = System.IO.Path.Combine(path, "output_" + milestoneInt + ".html");
                if (System.IO.File.Exists(filename))
                {
                    return File(System.IO.File.OpenRead(filename), "text/html");
                }
                else
                    return NotFound();

            }
            else
                return NotFound();
        }

        [HttpPost("newFile")]
        public IActionResult NewFile(string description)
        {
            RepoMapper.Entry entry;
            entry = new RepoMapper.Entry()
            {
                Key = GenerateUniqueNewName(),
                Description = description,
                LastMilestone = 1,
                LastUpdated = DateTime.Now,
                IsNew = true
            };

            mapper.InsertEntry(entry);
            mapper.InsertMilestone(new RepoMapper.EntryMilestone() { Created = entry.LastUpdated, Comments = "", Nr = entry.LastMilestone, EntryKey = entry.Key });

            logger.LogInformation("Creating new entry" + entry.Key);

            return Json(new HandlerResult()
            {
                Result = new
                {
                    Name = entry.Key,
                    Milestone = entry.LastMilestone,
                    HTML = GetDefaultHTML(),
                    CSS = GetDefaultCSS(),
                    Typescript = GetDefaultTypescript()
                },
                Success = true
            });
        }

        [HttpGet("loadFile")]
        public IActionResult LoadFile(string file, string milestone)
        {
            var entry = mapper.GetEntry(file);
            if (entry == null)
                return Json(new HandlerResult() { Success = false, Message = "File does not exists" });

            var path = System.IO.Path.Combine(repoPath, file);
            //if (!System.IO.Directory.Exists(path))
            //    return Json(new HandlerResult() { Success = false });

            if (milestone == "-1")
            {
                milestone = entry.LastMilestone + ""; // GetLastMilestone(name) + "";
            }
            else
            {
                int ms;
                if (!int.TryParse(milestone, out ms))
                    return Json(new HandlerResult() { Success = false, Message = "Invalid milestone" });
                if (ms > entry.LastMilestone)
                    return Json(new HandlerResult() { Success = false, Message = "Invalid milestone" });
            }

            string html;
            string css;
            string typescript;

            string filename;
            filename = System.IO.Path.Combine(path, "html_" + milestone + ".html");
            if (System.IO.File.Exists(filename))
                html = System.IO.File.ReadAllText(filename);
            else
            {
                html = GetDefaultHTML();
                //return Json(new HandlerResult() { Success = false, Message = "Files not available" });
            }


            filename = System.IO.Path.Combine(path, "css_" + milestone + ".css");
            if (System.IO.File.Exists(filename))
                css = System.IO.File.ReadAllText(filename);
            else
            {
                css = GetDefaultCSS();
                //return Json(new HandlerResult() { Success = false, Message = "Files not available" });
            }
            filename = System.IO.Path.Combine(path, "ts_" + milestone + ".ts");
            if (System.IO.File.Exists(filename))
                typescript = System.IO.File.ReadAllText(filename);
            else
            {
                typescript = GetDefaultTypescript();
                //return Json(new HandlerResult() { Success = false, Message = "Files not available" });
            }
            logger.LogInformation("Loading entry " + entry.Key);


            return Json(new HandlerResult()
            {
                Result = new
                {
                    Name = file,
                    Milestone = milestone,
                    Description = entry.Description,
                    HTML = html,
                    CSS = css,
                    Typescript = typescript
                },
                Success = true
            });
        }

        [HttpPost("saveFile")]
        public IActionResult SaveFile(string name, int milestone, string html, string css, string typescript, string output)
        {
            if (string.IsNullOrEmpty(name) || name.Contains(".."))
                return Json(new HandlerResult() { Success = false });

            var entry = mapper.GetEntry(name);
            if (entry == null)
                return Json(new HandlerResult() { Success = false });

            if (milestone < entry.LastMilestone)
            {
                return Json(new HandlerResult()
                {
                    Success = false,
                    Message = "Can't save an older milestone. Last milestone is " + entry.LastMilestone
                });
            }

            Save(entry, html, css, typescript, output);

            logger.LogInformation("Saving entry " + entry.Key + ", last milestone : " + entry.LastMilestone);

            return Json(new HandlerResult()
            {
                Success = true
            });
        }

        [HttpGet("listFiles")]
        public IActionResult ListFiles()
        {
            var entries = mapper.GetEntries().Where(e => !e.IsNew).ToList();

            var names = System.IO.Directory.GetDirectories(repoPath);
            return Json(new HandlerResult()
            {
                Result = entries.OrderByDescending(e => e.LastUpdated)
                                .Select(e => new { Name = e.Key, Milestone = e.LastMilestone, LastUpdated = e.LastUpdated.ToString("yyyy-MM-dd"), Description = e.Description })
                                .ToArray(),
                Success = true
            });
        }

        [HttpPost("createMilestone")]
        public IActionResult CreateMileStone(string name, string html, string css, string typescript, string output, string comments)
        {

            var entry = mapper.GetEntry(name);
            if (entry == null)
                return Json(new HandlerResult() { Success = false });

            entry.LastMilestone++;

            Save(entry, html, css, typescript, output);

            logger.LogInformation("Creating new milestone " + entry.LastMilestone + " for " + entry.Key);

            mapper.InsertMilestone(new RepoMapper.EntryMilestone()
            {
                EntryKey = name,
                Nr = entry.LastMilestone,
                Created = DateTime.Today,
                Comments = comments
            });
            return Json(new HandlerResult()
            {
                Result = new
                {
                    Name = name,
                    Description = entry.Description,
                    Milestone = entry.LastMilestone
                },
                Success = true
            });
        }

        [HttpPost("deleteMilestone")]
        public IActionResult DeleteMilestone(string name)
        {
            var entry = mapper.GetEntry(name);
            if (entry == null)
                return Json(new HandlerResult() { Success = false });

            if (entry.LastMilestone == 1)
            {
                mapper.DeleteEntry(entry);
                return Json(new HandlerResult() { Success = true, Result = true });
            }
            else
            {
                int milestone = entry.LastMilestone;
                entry.LastMilestone--;
                mapper.UpdateEntry(entry);

                var ms = mapper.GetMilestone(name, milestone - 1);
                if (ms != null)
                    mapper.DeleteMilestone(ms);

                return Json(new HandlerResult() { Success = true, Result = false });
            }
        }

        [HttpPost("updateDescription")]
        public IActionResult UpdateDescription(string name, string description)
        {
            var entry = mapper.GetEntry(name);
            if (entry == null)
                return Json(new HandlerResult() { Success = false });

            entry.Description = description;
            mapper.UpdateEntry(entry);

            return Json(new HandlerResult() { Success = true });
        }

        private void Save(RepoMapper.Entry entry, string html, string css, string typescript, string output)
        {
            var path = System.IO.Path.Combine(repoPath, entry.Key);
            if (!System.IO.Directory.Exists(path))
                System.IO.Directory.CreateDirectory(path);


            string filename;

            filename = System.IO.Path.Combine(path, "html_" + entry.LastMilestone + ".html");
            System.IO.File.WriteAllText(filename, html);

            filename = System.IO.Path.Combine(path, "css_" + entry.LastMilestone + ".css");
            System.IO.File.WriteAllText(filename, css);

            filename = System.IO.Path.Combine(path, "ts_" + entry.LastMilestone + ".ts");
            System.IO.File.WriteAllText(filename, typescript);

            filename = System.IO.Path.Combine(path, "output_" + entry.LastMilestone + ".html");
            System.IO.File.WriteAllText(filename, output);

            entry.IsNew = false;
            entry.LastUpdated = DateTime.Now;
            mapper.UpdateEntry(entry);
        }


        private string GenerateNewName()
        {
            char[] chars = "bcdfghjklmnpqrstvwxz".ToCharArray();
            char[] vowels = "aeiou".ToCharArray();

            Random rnd = new Random();
            StringBuilder str = new StringBuilder();
            for (int i = 0; i < 8; i++)
            {
                if (i % 2 == 0)
                    str.Append(chars[rnd.Next(chars.Length)]);
                else
                    str.Append(vowels[rnd.Next(vowels.Length)]);
            }
            return str.ToString();
        }
        private string GenerateUniqueNewName()
        {
            int errCount = 0;
            string name = GenerateNewName();
            while (System.IO.Directory.Exists(System.IO.Path.Combine(repoPath, name)) && errCount++ < 10)
                name = GenerateNewName();
            return name;
        }

        private int GetLastMilestone(string name)
        {
            var path = System.IO.Path.Combine(repoPath, name);
            if (!System.IO.Directory.Exists(path))
                return -1;
            else
            {
                var milestones = System.IO.Directory.GetFiles(path).Where(f => System.IO.Path.GetFileName(f).StartsWith("ts_")).Select(f => int.Parse(System.IO.Path.GetFileNameWithoutExtension(f).Split('_')[1])).ToArray();
                if (milestones.Length > 0)
                    return milestones.Max();
                else
                    return 1;
            }
        }


        private string GetDefaultHTML()
        {
            string path = System.IO.Path.Combine(repoPath, "default.html");
            if (System.IO.File.Exists(path))
                return System.IO.File.ReadAllText(path);
            else
            {
                return
@"<html>
    <head>
        <title>Typescript Editor - Hello</title>
        <!--%CSS%-->
    </head>
    <body>
        <h1>New typescript snippet</h1>
        <!--%Javascript%-->
    </body>
    
</html>";
            }
        }

        private string GetDefaultCSS()
        {
            string path = System.IO.Path.Combine(repoPath, "default.css");
            if (System.IO.File.Exists(path))
                return System.IO.File.ReadAllText(path);
            else
            {
                return
@"body {

}";
            }
        }

        private string GetDefaultTypescript()
        {
            string path = System.IO.Path.Combine(repoPath, "default.ts");
            if (System.IO.File.Exists(path))
                return System.IO.File.ReadAllText(path);
            else
            {
                return
@"class Hello {

}";
            }
        }

        public class HandlerResult
        {
            public bool Success { get; set; }
            public object Result { get; set; }
            public string Message { get; set; }
        }

    }
}
