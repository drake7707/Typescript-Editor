using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Microsoft.Data.Sqlite;

using System.Data;
using Dapper;

namespace TypescriptEditorHandler
{


    public class RepoMapper
    {

        private string connectionString;
        private IDbConnection connection;
        private IDbConnection GetConnection()
        {
            if (connection == null || connection.State != System.Data.ConnectionState.Open)
            {

                if (connection != null)
                {
                    connection.Close();
                    connection.Dispose();
                }
                connection = new SqliteConnection(connectionString);
                connection.Open();
            }
            return (SqliteConnection)connection;
        }

        public RepoMapper(string dbfile)
        {
            connectionString = string.Format("Data Source={0}", dbfile);
            CreateDatabaseIfNotExists(dbfile);

            SimpleCRUD.SetDialect(SimpleCRUD.Dialect.SQLite);
        }

        public void CreateDatabaseIfNotExists(string dbfile)
        {
            if (!System.IO.File.Exists(dbfile))
            {
                ExecuteQuery(@"CREATE TABLE [Entry] (
                                [Id] integer NOT NULL PRIMARY KEY, 
                                [Key] varchar(254), 
	                            [Description] varchar(254), 
	                            [LastMilestone] nvarchar(254), 
                                [IsNew] tinyint,
	                            [LastUpdated] datetime
                            )");
                ExecuteQuery(@"CREATE TABLE [EntryMilestone] (
                                [Id] integer NOT NULL PRIMARY KEY, 
                                [Nr] integer NOT NULL, 
                                [EntryKey] varchar(254) NOT NULL, 
	                            [Comments] varchar(254), 
	                            [Created] datetime
                            )");

                ExecuteQuery(@"CREATE TABLE [SaveHistory] (
                                [Id] integer NOT NULL PRIMARY KEY, 
                                [EntryKey] varchar(254) NOT NULL, 
                                [Milestone] int NOT NULL, 
                                [SavedOn] datetime NOT NULL
                            )");
            }
        }
        private int ExecuteQuery(string query)
        {
            var conn = GetConnection();
            try
            {
                using (SqliteCommand cmd = new SqliteCommand(query, (SqliteConnection)conn))
                {
                    return cmd.ExecuteNonQuery();
                }
            }
            finally
            { }
        }


        public IEnumerable<Entry> GetEntries()
        {
            return GetConnection().GetList<Entry>();
        }

        public List<EntryMilestone> GetMilestones(string key)
        {
            return GetConnection().GetList<EntryMilestone>().Where(e => e.EntryKey == key).ToList();
        }

        public void InsertMilestone(EntryMilestone milestone)
        {
            GetConnection().Insert(milestone);
        }

        public void UpdateEntry(Entry e)
        {
            GetConnection().Update(e);

            GetConnection().Insert(new SaveHistory()
            {
                EntryKey = e.Key,
                Milestone = e.LastMilestone,
                SavedOn = DateTime.Now
            });
        }

        public void InsertEntry(Entry e)
        {
            var entry = GetConnection().Insert(e);
            e.Id = entry.Value;

        }

        public class SaveHistory
        {
            public int Id { get; set; }
            public string EntryKey { get; set; }

            public int Milestone { get; set; }

            public DateTime SavedOn { get; set; }
        }

        public class Entry
        {
            public int Id { get; set; }

            public string Key { get; set; }

            public string Description { get; set; }

            public int LastMilestone { get; set; }

            public bool IsNew { get; set; }
            public DateTime LastUpdated { get; set; }

        }



        public class EntryMilestone
        {
            public int Id { get; set; }
            public int Nr { get; set; }

            public string EntryKey { get; set; }

            public string Comments { get; set; }

            public DateTime Created { get; set; }
        }

        internal Entry GetEntry(string name)
        {
            return GetConnection().GetList<Entry>().Where(e => e.Key == name).FirstOrDefault();
        }

        internal void DeleteEntry(Entry entry)
        {
            GetConnection().Delete(entry);
        }

        internal EntryMilestone GetMilestone(string name, int milestone)
        {
            return GetConnection().GetList<EntryMilestone>().Where(m => m.EntryKey == name && m.Nr == milestone).FirstOrDefault();
        }

        internal void DeleteMilestone(EntryMilestone ms)
        {
            GetConnection().Delete(ms);
        }
    }
}
